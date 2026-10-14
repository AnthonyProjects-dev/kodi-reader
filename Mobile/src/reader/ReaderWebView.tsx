import { File } from 'expo-file-system';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, useWindowDimensions, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { runtimeURL } from './runtime';
import { highlightPayload, inlineStyle, cssVariables, runtimeOptions } from './settingsToCss';
import { chapterTitle as chapterTitleFor, spineIndexForPath } from '@/lib/epub/parse';
import { extensionOf, resolveHref, splitFragment } from '@/lib/epub/path';
import { directoryAt, directoryURL, rootDirectory } from '@/lib/files';
import type { Palette } from '@/lib/theme';
import type { Annotation, BookRecord, Locator, Publication, ReaderSettings, TextPosition } from '@/lib/types';

export type ReaderSelection = {
  text: string;
  locator: Locator;
  rect: { x: number; y: number; width: number; height: number };
};

export type ReaderMeta = {
  spineIndex: number;
  page: number;
  pageCount: number;
  chapterTitle?: string;
  progress: number;
};

export type ReaderHandle = {
  nextPage(): void;
  previousPage(): void;
  nextChapter(): void;
  previousChapter(): void;
  goToLocator(locator: Locator): void;
  goToPath(path: string, fragment?: string): void;
  goToPage(page: number): void;
  clearSelection(): void;
};

type Props = {
  book: BookRecord;
  publication: Publication;
  settings: ReaderSettings;
  palette: Palette;
  annotations: Annotation[];
  insets: { top: number; bottom: number };
  initialLocator?: Locator;
  onMeta: (meta: ReaderMeta, locator: Locator | null) => void;
  onSelection: (selection: ReaderSelection | null) => void;
  onHighlightTapped: (id: string, rect: ReaderSelection['rect']) => void;
  onTap: () => void;
  onLoadingChange: (loading: boolean) => void;
  onError: (message: string) => void;
};

type PendingTarget = { position?: TextPosition; fragment?: string; goToEnd?: boolean };

function escapeForScript(value: unknown): string {
  // JSON inside a <script> injection must not terminate the script early.
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
}

/**
 * Hosts one spine document at a time inside a WKWebView, with the Kodi reader
 * runtime injected into the document head. All page-turn, selection, and
 * highlight logic lives in reader.js; this component only relays messages.
 */
export const ReaderWebView = forwardRef<ReaderHandle, Props>(function ReaderWebView(
  { book, publication, settings, palette, annotations, insets, initialLocator, onMeta, onSelection, onHighlightTapped, onTap, onLoadingChange, onError },
  ref,
) {
  const { width } = useWindowDimensions();
  const webViewRef = useRef<WebView>(null);
  const [source, setSource] = useState<{ uri: string } | null>(null);
  const sourceRef = useRef<string | null>(null);
  const spineIndexRef = useRef(initialLocator?.spineIndex ?? 0);
  const readyRef = useRef(false);
  const pendingRef = useRef<PendingTarget>({});
  const pageRef = useRef({ page: 0, pageCount: 1 });
  const configureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const extractedDirectory = useMemo(() => directoryAt(book.extractedRelativePath ?? ''), [book.extractedRelativePath]);
  const readAccessURL = useMemo(() => directoryURL(rootDirectory) + '/', []);

  const totalWeight = useMemo(() => publication.weights.reduce((sum, weight) => sum + weight, 0), [publication.weights]);

  const overallProgress = useCallback(
    (spineIndex: number, withinChapter: number) => {
      if (totalWeight <= 0) return 0;
      let before = 0;
      for (let i = 0; i < spineIndex; i += 1) before += publication.weights[i] ?? 0;
      const current = publication.weights[spineIndex] ?? 0;
      return Math.min(1, Math.max(0, (before + current * withinChapter) / totalWeight));
    },
    [publication.weights, totalWeight],
  );

  const evaluate = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(`${script}; true;`);
  }, []);

  const currentOptions = useCallback(
    () => runtimeOptions(settings, palette, width, insets),
    [settings, palette, width, insets],
  );

  const pushHighlights = useCallback(() => {
    const spineIndex = spineIndexRef.current;
    const payloads = annotations
      .filter((annotation) => annotation.locator.spineIndex === spineIndex)
      .map(highlightPayload);
    evaluate(`window.__reader && __reader.setHighlights(${escapeForScript(payloads)})`);
  }, [annotations, evaluate]);

  /** Writes an injected copy of the chapter next to the original and loads it. */
  const loadSpine = useCallback(
    (index: number, target: PendingTarget = {}) => {
      const order = publication.readingOrder;
      if (index < 0 || index >= order.length) return;
      readyRef.current = false;
      pendingRef.current = target;
      spineIndexRef.current = index;
      onSelection(null);
      onLoadingChange(true);

      try {
        const path = order[index].path;
        const segments = path.split('/');
        const fileName = segments.pop() ?? path;
        const original = new File(extractedDirectory, ...segments, fileName);
        let html = original.textSync();

        const variables = cssVariables(settings, palette, width, insets);
        const tags = [
          '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>',
          `<style id="kodi-boot">${inlineStyle(variables)}</style>`,
          `<link rel="stylesheet" type="text/css" href="${runtimeURL('reader.css')}"/>`,
          `<script src="${runtimeURL('reader.js')}"></script>`,
          `<script src="${runtimeURL('bridge.js')}"></script>`,
        ].join('\n');

        const headClose = html.search(/<\/head>/i);
        if (headClose >= 0) {
          html = `${html.slice(0, headClose)}${tags}\n${html.slice(headClose)}`;
        } else {
          const bodyOpen = html.search(/<body/i);
          html = bodyOpen >= 0 ? `${html.slice(0, bodyOpen)}<head>${tags}</head>\n${html.slice(bodyOpen)}` : tags + html;
        }

        const extension = extensionOf(fileName) || 'xhtml';
        const stem = fileName.replace(/\.[^.]+$/, '');
        const injected = new File(extractedDirectory, ...segments, `${stem}.kodi.${extension}`);
        if (injected.exists) injected.delete();
        injected.write(html);
        if (sourceRef.current === injected.uri) {
          // Same document again (settings-only rewrite or a dev reload): a new
          // source object would not trigger a load, so reload explicitly.
          webViewRef.current?.reload();
        } else {
          sourceRef.current = injected.uri;
          setSource({ uri: injected.uri });
        }
      } catch (error) {
        onLoadingChange(false);
        onError(error instanceof Error ? error.message : String(error));
      }
    },
    [publication.readingOrder, extractedDirectory, settings, palette, width, insets, onSelection, onLoadingChange, onError],
  );

  // First load.
  useEffect(() => {
    const locator = initialLocator && initialLocator.kind !== 'pdf' ? initialLocator : undefined;
    const index = Math.min(Math.max(locator?.spineIndex ?? 0, 0), publication.readingOrder.length - 1);
    loadSpine(index, { position: locator?.start.elementPath.length ? locator.start : undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // Settings or viewport changes reflow the page around the current position.
  const lastOptionsKey = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify(currentOptions());
    if (lastOptionsKey.current === key) return;
    lastOptionsKey.current = key;
    if (!readyRef.current) return;
    if (configureTimer.current) clearTimeout(configureTimer.current);
    configureTimer.current = setTimeout(() => {
      evaluate(`window.__reader && __reader.configure(${escapeForScript(currentOptions())}, true)`);
    }, 120);
  }, [currentOptions, evaluate]);

  useEffect(() => {
    if (readyRef.current) pushHighlights();
  }, [pushHighlights]);

  const reportMeta = useCallback(
    (page: number, pageCount: number, withinChapter: number, position: TextPosition | null) => {
      const spineIndex = spineIndexRef.current;
      const progress = overallProgress(spineIndex, withinChapter);
      pageRef.current = { page, pageCount };
      const locator: Locator | null = position
        ? { kind: 'epub', spineIndex, start: position, totalProgression: progress }
        : null;
      onMeta({ spineIndex, page, pageCount, chapterTitle: chapterTitleFor(publication, spineIndex), progress }, locator);
    },
    [overallProgress, onMeta, publication],
  );

  const handleLink = useCallback(
    (href: string) => {
      const lower = href.toLowerCase();
      if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:') || lower.startsWith('tel:')) {
        Linking.openURL(href).catch(() => undefined);
        return;
      }
      const { path, fragment } = splitFragment(href);
      if (!path) {
        if (fragment) evaluate(`__reader.goToFragment(${escapeForScript(fragment)}, true)`);
        return;
      }
      const currentPath = publication.readingOrder[spineIndexRef.current]?.path ?? '';
      const resolved = resolveHref(path, currentPath);
      const index = spineIndexForPath(publication, resolved);
      if (index < 0) return;
      if (index === spineIndexRef.current) {
        if (fragment) evaluate(`__reader.goToFragment(${escapeForScript(fragment)}, true)`);
        return;
      }
      loadSpine(index, { fragment });
    },
    [publication, evaluate, loadSpine],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let body: Record<string, any>;
      try {
        body = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (__DEV__ && body.type !== 'pageChanged') console.log('[reader]', body.type);
      switch (body.type) {
        case 'domReady': {
          const options = { ...currentOptions(), spineIndex: spineIndexRef.current };
          evaluate(`__reader.start(${escapeForScript(options)})`);
          break;
        }
        case 'ready': {
          readyRef.current = true;
          const pending = pendingRef.current;
          pendingRef.current = {};
          if (pending.goToEnd) {
            evaluate('__reader.goToEnd()');
          } else if (pending.fragment) {
            evaluate(`__reader.goToFragment(${escapeForScript(pending.fragment)}, false)`);
          } else if (pending.position && pending.position.elementPath.length > 0) {
            evaluate(`__reader.goToPosition(${escapeForScript(pending.position)}, false)`);
          }
          pushHighlights();
          evaluate('__reader.notifyState()');
          onLoadingChange(false);
          break;
        }
        case 'pageChanged': {
          const page = Number(body.page ?? 0);
          const pageCount = Math.max(1, Number(body.pageCount ?? 1));
          const progression = Number(body.progression ?? 0);
          const position = body.position && Array.isArray(body.position.elementPath) ? (body.position as TextPosition) : null;
          onSelection(null);
          reportMeta(page, pageCount, progression, position);
          break;
        }
        case 'reachedEnd':
          if (spineIndexRef.current + 1 < publication.readingOrder.length) loadSpine(spineIndexRef.current + 1);
          break;
        case 'reachedStart':
          if (spineIndexRef.current > 0) loadSpine(spineIndexRef.current - 1, { goToEnd: true });
          break;
        case 'selection': {
          const locatorBody = body.locator ?? {};
          const start = locatorBody.start as TextPosition | undefined;
          if (!start || typeof body.text !== 'string') break;
          onSelection({
            text: body.text,
            locator: { kind: 'epub', spineIndex: spineIndexRef.current, start, end: locatorBody.end, text: body.text },
            rect: body.rect ?? { x: 0, y: 0, width: 0, height: 0 },
          });
          break;
        }
        case 'selectionCleared':
          onSelection(null);
          break;
        case 'highlightTapped':
          if (typeof body.id === 'string') onHighlightTapped(body.id, body.rect ?? { x: 0, y: 0, width: 0, height: 0 });
          break;
        case 'tap':
          onTap();
          break;
        case 'link':
          if (typeof body.href === 'string') handleLink(body.href);
          break;
        case 'error':
          onError(`${body.context ?? 'reader'}: ${body.message ?? 'unknown error'}`);
          break;
        default:
          break;
      }
    },
    [currentOptions, evaluate, pushHighlights, onLoadingChange, onSelection, reportMeta, publication.readingOrder.length, loadSpine, onHighlightTapped, onTap, handleLink, onError],
  );

  useImperativeHandle(
    ref,
    () => ({
      nextPage: () => evaluate('if (window.__reader && !__reader.nextPage()) window.ReactNativeWebView.postMessage(JSON.stringify({ type: "reachedEnd" }))'),
      previousPage: () => evaluate('if (window.__reader && !__reader.previousPage()) window.ReactNativeWebView.postMessage(JSON.stringify({ type: "reachedStart" }))'),
      nextChapter: () => loadSpine(spineIndexRef.current + 1),
      previousChapter: () => loadSpine(spineIndexRef.current - 1),
      goToLocator: (locator) => {
        if (locator.spineIndex === spineIndexRef.current && readyRef.current) {
          evaluate(`__reader.goToPosition(${escapeForScript(locator.start)}, true)`);
        } else {
          loadSpine(locator.spineIndex, { position: locator.start });
        }
      },
      goToPath: (path, fragment) => {
        const index = spineIndexForPath(publication, path);
        if (index < 0) return;
        if (index === spineIndexRef.current && readyRef.current) {
          if (fragment) evaluate(`__reader.goToFragment(${escapeForScript(fragment)}, true)`);
          else evaluate('__reader.goToPage(0, true)');
        } else {
          loadSpine(index, { fragment });
        }
      },
      goToPage: (page) => evaluate(`__reader.goToPage(${Math.round(page)}, false)`),
      clearSelection: () => evaluate('window.__reader && __reader.clearSelection()'),
    }),
    [evaluate, loadSpine, publication],
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.page }]}>
      {source ? (
        <WebView
          ref={webViewRef}
          key={book.id}
          source={source}
          originWhitelist={['*']}
          allowingReadAccessToURL={readAccessURL}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          onMessage={onMessage}
          onShouldStartLoadWithRequest={(request) => {
            const url = request.url;
            if (url.startsWith('file://') || url === 'about:blank') return true;
            Linking.openURL(url).catch(() => undefined);
            return false;
          }}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          allowsLinkPreview={false}
          dataDetectorTypes="none"
          menuItems={[]}
          suppressMenuItems={['cut', 'copy', 'paste', 'replace', 'bold', 'italic', 'underline', 'select', 'selectAll', 'translate', 'lookup', 'share']}
          hideKeyboardAccessoryView
          webviewDebuggingEnabled={__DEV__}
          style={[styles.webView, { backgroundColor: palette.page }]}
          containerStyle={{ backgroundColor: palette.page }}
          onError={(event) => onError(event.nativeEvent.description)}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  webView: { flex: 1, opacity: 0.99 },
});

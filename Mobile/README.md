# Kodi Reader for iOS

A native-feeling mobile variant of [Kodi Reader](https://github.com/dev-olly/kodi-reader),
built with Expo SDK 57, Expo Router, and `@expo/ui` SwiftUI components. iOS 26
Liquid Glass is used for the reader chrome, the tab bar, and native sheets.

## What it does

- Imports EPUB and PDF files from the Files app, or adds two bundled Project
  Gutenberg samples (Alice in Wonderland, Frankenstein).
- Paginated EPUB reading with the same `reader.js` and `reader.css` engine as
  the Mac app, hosted in a `WKWebView`. Swipe or tap the edges to turn pages,
  tap the centre to show or hide the chrome.
- Highlights in five colours plus underline, with notes. Positions and
  highlights use the same simplified-CFI anchors as the Mac app, so they survive
  font and theme changes.
- Typography and theme controls (New York, Georgia, Palatino, Charter, Helvetica,
  San Francisco; size, line spacing, margins, justify, hyphenation).
- Notes tab across all books with Markdown export via the share sheet.
- Open any web page in the in-app browser and save it as a reader-mode book
  (Readability extraction, images inlined, packaged as a one-chapter EPUB).
- PDFs open in the native WebKit PDF viewer (read-only, no highlights yet).

## Layout

```
src/app/                 Expo Router routes
  (tabs)/library|notes|settings   native tab bar with a Stack per tab
  reader/[id].tsx        full-screen reader with glass chrome
  reader/contents.tsx    table of contents (form sheet)
  reader/typography.tsx  appearance controls (form sheet, @expo/ui Form)
  web/index.tsx          in-app browser with "Save as Book"
  note/[bookId]/[annotationId].tsx   note editor (form sheet)
src/reader/              ReaderWebView bridge, runtime install, settings → CSS
src/reader/runtime/      reader.js + reader.css copied from the Mac app, plus bridge.js
src/lib/epub/            unzip (fflate), OPF/NCX/nav parsing, path helpers
src/lib/web/article.ts   Readability result → EPUB (port of ArticleEPUBBuilder)
src/lib/store.ts         library.json store (positions, annotations, settings)
src/components/          GlassSurface, HighlightPalette, BookRow, AppearanceForm
```

Data lives under the app's Documents directory in `Kodi/`:
`library.json`, `Books/`, `Extracted/`, `Covers/`, `runtime/`.

## Running

```sh
npm install
npx expo run:ios            # needs Xcode 26 and CocoaPods
```

`@expo/ui` and `expo-glass-effect` need a development build; Expo Go is not
enough. On this Mac CocoaPods lives in a user-local Ruby 3.3, so run:

```sh
export PATH="$HOME/.local/ruby-env/bin:$PATH" LANG=en_US.UTF-8
npx expo run:ios --device "iPhone 17 Pro"
```

In development builds, `kodi://library?addSamples=1` imports the bundled
sample books without touching the UI (handy for simulator testing).

Liquid Glass renders on iOS 26 simulators and devices; older systems get a
translucent fallback with the same geometry.

## Not yet ported

Ask AI, cloud sync, Excalidraw drawings, and PDF highlights.

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Run swift test first to build EpubKit and its dependency.
TEMP_BUILD=$(mktemp -d "${TMPDIR:-/tmp}/kodi-export-tests.XXXXXX")
trap 'rm -rf "$TEMP_BUILD"' EXIT
BUILD_DIR=".build/$(uname -m)-apple-macosx/debug"
{
  printf 'import AppKit\nimport EpubKit\nimport UniformTypeIdentifiers\n'
  sed -n '/^@MainActor/,$p' App/AnnotationViews.swift
} > "$TEMP_BUILD/NotesExporter.swift"
xcrun swiftc -module-cache-path "${TMPDIR:-/tmp}/kodi-note-module-cache" \
  -I "$BUILD_DIR/Modules" -parse-as-library \
  "$TEMP_BUILD/NotesExporter.swift" Tests/AppTests/NoteExportTests.swift \
  "$BUILD_DIR"/EpubKit.build/*.swift.o "$BUILD_DIR"/ZIPFoundation.build/*.swift.o \
  -o "$TEMP_BUILD/export-tests"
"$TEMP_BUILD/export-tests"

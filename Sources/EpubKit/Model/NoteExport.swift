import Foundation

/// Portable representations of notes and their source passages.
public enum NoteExportFormat: String, CaseIterable, Sendable {
    case markdown, word, appleNotes, notion

    public var label: String {
        switch self {
        case .markdown: return "Markdown (.md)"
        case .word: return "Word (.docx)"
        case .appleNotes: return "Apple Notes (.html)"
        case .notion: return "Notion (.md)"
        }
    }

    public var fileExtension: String {
        switch self {
        case .markdown, .notion: return "md"
        case .word: return "docx"
        case .appleNotes: return "html"
        }
    }

    public var instructions: String {
        switch self {
        case .markdown: return "Includes each note, its referenced passage, and book citation."
        case .word: return "Save a formatted Word document with notes, passages, and citations."
        case .appleNotes: return "In Apple Notes, choose File → Import to Notes and select this HTML file."
        case .notion: return "In Notion, choose Settings → Import → Text & Markdown and select this file."
        }
    }
}

public enum NoteExport {
    public static func html(bookTitle: String, author: String, annotations: [Annotation]) -> String {
        let author = author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Unknown Author" : author
        let notes = annotations.filter(\.hasContent).sorted {
            ($0.locator.spineIndex, $0.createdAt) < ($1.locator.spineIndex, $1.createdAt)
        }
        var body = "<h1>\(escape("Notes — " + bookTitle))</h1><p>\(escape(author))</p>"
        if notes.isEmpty { body += "<p><em>No notes yet.</em></p>" }
        for note in notes {
            let chapter = note.chapterTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let section = chapter.isEmpty ? "Untitled section" : chapter
            body += "<h2>\(escape(section))</h2>"
            // Source text is always literal; book passages can contain Markdown or HTML.
            body += "<blockquote>\(escape(note.text).replacingOccurrences(of: "\n", with: "<br>"))</blockquote>"
            body += "<p><em>\(escape("— \(section), \(author), \(bookTitle)"))</em></p>"
            body += render(note.note ?? "")
            if note.hasDrawing { body += "<p><em>Visual note attached in Kodi Reader; drawing is not included in this export.</em></p>" }
            body += "<hr>"
        }
        return """
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><title>\(escape("Notes — " + bookTitle))</title>
        <style>body{font-family:Helvetica,Arial,sans-serif;font-size:12pt;line-height:1.5;max-width:760px;margin:40px auto;color:#222}blockquote{margin:16px 0;padding-left:18px;border-left:3px solid #888}pre,code{font-family:Menlo,monospace}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:6px}</style>
        </head><body>\(body)</body></html>
        """
    }

    private static func render(_ markdown: String) -> String {
        NoteMarkdown.previewBlocks(of: markdown).map { block in
            switch block {
            case .paragraph(let text):
                return text.components(separatedBy: "\n").map { line in
                    if let prefix = line.range(of: #"^#{1,6} "#, options: .regularExpression) {
                        let level = line[prefix].count - 1
                        return "<h\(level)>\(inline(String(line[prefix.upperBound...])))</h\(level)>"
                    }
                    if line.hasPrefix("> ") { return "<blockquote>\(inline(String(line.dropFirst(2))))</blockquote>" }
                    if ["---", "***", "___"].contains(line.trimmingCharacters(in: .whitespaces)) { return "<hr>" }
                    return "<p>\(inline(line))</p>"
                }.joined()
            case .unorderedList(let items):
                return "<ul>" + items.map { "<li>\(inline($0))</li>" }.joined() + "</ul>"
            case .orderedList(let items):
                return "<ol>" + items.map { "<li>\(inline($0))</li>" }.joined() + "</ol>"
            case .taskList(let items):
                return "<ul>" + items.map { "<li>\($0.checked ? "☑" : "☐") \(inline($0.text))</li>" }.joined() + "</ul>"
            case .code(let code): return "<pre><code>\(escape(code))</code></pre>"
            case .table(let header, let rows, _):
                return "<table><tr>" + header.map { "<th>\(inline($0))</th>" }.joined() + "</tr>"
                    + rows.map { "<tr>" + $0.map { "<td>\(inline($0))</td>" }.joined() + "</tr>" }.joined() + "</table>"
            }
        }.joined()
    }

    private static func inline(_ text: String) -> String {
        let marked = text.replacingOccurrences(of: "<u>", with: "\u{E000}")
            .replacingOccurrences(of: "</u>", with: "\u{E001}")
        guard let parsed = try? AttributedString(markdown: marked, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else { return escape(text) }
        var underlined = false
        var output = ""
        for run in parsed.runs {
            for chunk in String(parsed[run.range].characters).components(separatedBy: "\u{E000}").enumerated() {
                if chunk.offset > 0 { underlined = true }
                for end in chunk.element.components(separatedBy: "\u{E001}").enumerated() {
                    if end.offset > 0 { underlined = false }
                    var value = escape(end.element)
                    let intent = run.inlinePresentationIntent ?? []
                    if intent.contains(.code) { value = "<code>\(value)</code>" }
                    if intent.contains(.stronglyEmphasized) { value = "<strong>\(value)</strong>" }
                    if intent.contains(.emphasized) { value = "<em>\(value)</em>" }
                    if intent.contains(.strikethrough) { value = "<del>\(value)</del>" }
                    if underlined { value = "<u>\(value)</u>" }
                    if let link = run.link, ["https", "http", "mailto"].contains(link.scheme?.lowercased() ?? "") {
                        value = "<a href=\"\(escape(link.absoluteString))\">\(value)</a>"
                    }
                    output += value
                }
            }
        }
        return output
    }

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

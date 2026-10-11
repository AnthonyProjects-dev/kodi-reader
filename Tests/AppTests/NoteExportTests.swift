import AppKit
import EpubKit

@main
struct NoteExportSmokeTests {
    @MainActor
    static func main() throws {
        let annotation = Annotation(
            locator: Locator(spineIndex: 0, start: TextPosition(elementPath: [], offset: 0)),
            text: "Referenced passage <with> literal characters\nSecond line",
            note: "A **bold** note with <u>underline</u>\n\n- First item\n- Second item",
            chapterTitle: "Chapter One"
        )
        for format in NoteExportFormat.allCases {
            let output = try NotesExporter.data(format: format, bookTitle: "Test Book", author: "Test Author", annotations: [annotation])
            precondition(!output.isEmpty)
            if format == .word {
                precondition(output.starts(with: [0x50, 0x4b]), "DOCX must be a ZIP package")
                let document = try NSAttributedString(data: output, options: [.documentType: NSAttributedString.DocumentType.officeOpenXML], documentAttributes: nil)
                for text in ["Test Book", "Test Author", "Chapter One", "Referenced passage <with> literal characters", "Second line", "bold", "underline", "First item", "Second item"] {
                    precondition(document.string.contains(text), "DOCX lost: \(text)")
                }
                var hasBold = false
                var hasUnderline = false
                document.enumerateAttributes(in: NSRange(location: 0, length: document.length)) { attributes, _, _ in
                    if let font = attributes[.font] as? NSFont, NSFontManager.shared.traits(of: font).contains(.boldFontMask) { hasBold = true }
                    if let underline = attributes[.underlineStyle] as? Int, underline != 0 { hasUnderline = true }
                }
                precondition(hasBold && hasUnderline, "DOCX should preserve note styling")
                try output.write(to: URL(fileURLWithPath: "/tmp/kodi-note-export-smoke.docx"))
            }
        }
        print("All four note export formats passed; DOCX text and formatting round-trip passed.")
    }
}

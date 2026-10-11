import XCTest
@testable import EpubKit

final class NoteExportTests: XCTestCase {
    private func note(_ text: String = "A <literal> **passage**\nAnother line", body: String = "My **bold** and *italic* note") -> Annotation {
        Annotation(locator: Locator(spineIndex: 0, start: TextPosition(elementPath: [], offset: 0)), text: text, note: body, chapterTitle: "Chapter & One")
    }

    func testHTMLIncludesLiteralPassageCitationAndFormattedNote() {
        let html = NoteExport.html(bookTitle: "Book <Title>", author: "A & B", annotations: [note()])
        XCTAssertTrue(html.contains("A &lt;literal&gt; **passage**<br>Another line"))
        XCTAssertTrue(html.contains("— Chapter &amp; One, A &amp; B, Book &lt;Title&gt;"))
        XCTAssertTrue(html.contains("<strong>bold</strong>"))
        XCTAssertTrue(html.contains("<em>italic</em>"))
    }

    func testHTMLRendersSourceModeFormattingAndRejectsActiveContent() {
        let body = """
        # Heading

        - bullet

        - [x] done

        | A | B |
        | --- | --- |
        | 1 | 2 |

        ```
        <script>alert('x')</script>
        ```

        <u>**underlined**</u> and [safe](https://example.com?a=1&b=2) and [bad](javascript:alert)
        """
        let html = NoteExport.html(bookTitle: "Book", author: "Author", annotations: [note(body: body)])
        XCTAssertTrue(html.contains("<h1>Heading</h1>"))
        XCTAssertTrue(html.contains("<ul><li>bullet</li></ul>"))
        XCTAssertTrue(html.contains("☑ done"))
        XCTAssertTrue(html.contains("<table>"))
        XCTAssertTrue(html.contains("&lt;script&gt;"))
        XCTAssertFalse(html.contains("<script>"))
        XCTAssertTrue(html.contains("<u><strong>underlined</strong></u>"))
        XCTAssertTrue(html.contains("href=\"https://example.com?a=1&amp;b=2\""))
        XCTAssertFalse(html.contains("href=\"javascript:"))
    }

    func testHTMLFiltersBareHighlightsAndKeepsOrphanedQuotes() {
        var orphan = note("Stored quote", body: "Kept note")
        orphan.anchorStatus = .orphaned
        let bare = Annotation(locator: orphan.locator, text: "Bare highlight")
        let html = NoteExport.html(bookTitle: "Book", author: "", annotations: [bare, orphan])
        XCTAssertTrue(html.contains("Stored quote"))
        XCTAssertTrue(html.contains("Kept note"))
        XCTAssertTrue(html.contains("Unknown Author"))
        XCTAssertFalse(html.contains("Bare highlight"))
    }

    func testEmptyAndDrawingOnlyExports() {
        XCTAssertTrue(NoteExport.html(bookTitle: "Book", author: "Author", annotations: []).contains("No notes yet."))
        var drawing = note("Drawing passage", body: "")
        drawing.hasDrawing = true
        let html = NoteExport.html(bookTitle: "Book", author: "Author", annotations: [drawing])
        XCTAssertTrue(html.contains("Drawing passage"))
        XCTAssertTrue(html.contains("drawing is not included"))
    }

    func testMarkdownKeepsPassageLiteralAndNoteFormatting() {
        let markdown = NoteMarkdown.exportDocument(bookTitle: "Book", author: "Author", annotations: [note("A **literal** <passage>")])
        XCTAssertTrue(markdown.contains(#"> A \*\*literal\*\* \<passage\>"#))
        XCTAssertTrue(markdown.contains("My **bold** and *italic* note"))
    }

    func testFormatExtensions() {
        XCTAssertEqual(NoteExportFormat.allCases.map(\.fileExtension), ["md", "docx", "html", "md"])
    }
}

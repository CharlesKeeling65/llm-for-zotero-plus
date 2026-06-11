import { assert } from "chai";
import { classifyWriteNoteDestination } from "../src/agent/writeNoteDestination";

describe("write note destination classifier", function () {
  it("treats Zotero library note requests as Zotero note workflows", function () {
    assert.equal(
      classifyWriteNoteDestination(
        "save a standalone note into my Zotero library",
        "Obsidian",
      ),
      "zotero",
    );
    assert.equal(
      classifyWriteNoteDestination("create a reading note for this paper"),
      "zotero",
    );
  });

  it("treats explicit external destinations as file note workflows", function () {
    assert.equal(
      classifyWriteNoteDestination("write this figure note to my Obsidian"),
      "file",
    );
    assert.equal(
      classifyWriteNoteDestination("save this as a markdown file"),
      "file",
    );
    assert.equal(
      classifyWriteNoteDestination("write this to Research Vault", "Research Vault"),
      "file",
    );
  });

  it("does not turn ordinary paper requests into note destination rules", function () {
    assert.equal(classifyWriteNoteDestination("summarize this paper"), "none");
  });
});

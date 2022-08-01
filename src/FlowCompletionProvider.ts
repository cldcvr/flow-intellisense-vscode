import {
  CompletionItemProvider,
  TextDocument,
  Position,
  Range,
  CompletionItem,
  CompletionItemKind,
  SnippetString,
  CancellationToken,
  CompletionContext,
  ProviderResult,
  CompletionList,
  workspace,
} from "vscode";
import { FlowElementAttributeMeta, FlowElementMeta } from "./app";
import FlowBaseProvider, { TagObject } from "./FlowBaseProvider";

import componentmeta from "./config/elements";
const components = componentmeta as unknown as Record<string, FlowElementMeta>;

const prettyHTML = require("pretty");

export default class FlowCompletionItemProvider
  extends FlowBaseProvider
  implements CompletionItemProvider
{
  constructor() {
    super();
  }
  private size!: number | undefined;
  private quotes!: string;

  getPreAttr(): string {
    let txt = this.getTextBeforePosition(this._position).replace(
      /"[^'"]*(\s*)[^'"]*$/,
      ""
    );
    let end = this._position.character;
    let start = txt.lastIndexOf(" ", end) + 1;
    let parsedTxt = this._document.getText(
      new Range(this._position.line, start, this._position.line, end)
    );

    return this.matchAttr(this.attrReg, parsedTxt);
  }

  matchAttr(reg: RegExp, txt: string): string {
    let match: RegExpExecArray | null;
    match = reg.exec(txt);
    return (!/"[^"]*"/.test(txt) && match && match[1]) || "";
  }

  getTagSuggestion() {
    let suggestions = [];

    let id = 100;
    for (let tag in components) {
      suggestions.push(this.buildTagSuggestion(tag, components[tag], id));
      id++;
    }
    return suggestions;
  }

  getAttrValueSuggestion(tag: string, attr: string): CompletionItem[] {
    let suggestions: CompletionItem[] = [];
    const values = this.getAttrValues(tag, attr);

    let charPos = this._position.character;
    charPos += this._triggerCharacter === " " ? -1 : 0;

    for (let val in values) {
      const rangeOfSelectedValue = new Range(
        this._position.with({
          character: charPos,
        }),
        this._position.with({
          character: charPos,
        })
      );
      suggestions.push({
        label: val,
        kind: CompletionItemKind.Value,
        range: rangeOfSelectedValue,
      });
    }
    return suggestions;
  }

  getAttrSuggestion(tag: string) {
    let suggestions: CompletionItem[] = [];
    let tagAttrs = this.getTagAttrs(tag);
    let preText = this.getTextBeforePosition(this._position);
    let prefix =
      preText
        .replace(/['"]([^'"]*)['"]$/, "")
        .split(/\s|\(+/)
        .pop() || "";
    if (prefix) {
      // method attribute
      const method = prefix[0] === "@";
      // bind attribute
      const bind = prefix[0] === ":";

      prefix = prefix.replace(/[:@]/, "");

      if (/[^@:a-zA-z\s]/.test(prefix[0])) {
        return suggestions;
      }
      if (prefix != undefined) {
        tagAttrs.forEach((attr) => {
          const attrItem = this.getAttrItem(tag, attr);
          if (
            attrItem &&
            (!prefix.trim() || this.firstCharsEqual(attr, prefix))
          ) {
            const sug = this.buildAttrSuggestion(
              { attr, tag, bind, method },
              {
                description: attrItem.description,
                type: attrItem.type,
                optionType: attrItem.type,
                defaultValue: attrItem.default,
              }
            );
            if (sug) {
              suggestions.push(sug);
            }
          }
        });
      }
    }
    // for (let attr in ATTRS) {
    //   const attrItem = this.getAttrItem(tag, attr);
    //   if (attrItem && attrItem.global && (!prefix.trim() || this.firstCharsEqual(attr, prefix))) {
    //     const sug = this.buildAttrSuggestion({attr, tag: null, bind, method}, attrItem);
    //     sug && suggestions.push(sug);
    //   }
    // }

    return suggestions;
  }

  buildTagSuggestion(tag: string, tagVal: FlowElementMeta, id: number) {
    const snippets: string[] = [];
    let index = 0;
    let that = this;
    let defaults = [];
    for (let attr in tagVal.attributes) {
      const attrObj = tagVal.attributes[attr];

      if (attrObj.isRequired) {
        defaults.push(attr);
      }
    }
    function build(
      tag: string,
      { subtags, defaults }: Partial<FlowElementMeta>,
      snippets: string[]
    ) {
      let attrs = "";
      defaults &&
        defaults.forEach((item, i) => {
          attrs += ` ${item}=${that.quotes}$${index + i + 1}${that.quotes}`;
        });
      snippets.push(`${index > 0 ? "<" : ""}${tag}${attrs}>`);
      index++;
      subtags &&
        subtags.forEach((item) => build(item, components[item], snippets));
      snippets.push(`</${tag}>`);
    }
    build(tag, { subtags: [], defaults }, snippets);

    return {
      label: tag,
      sortText: `0${id}${tag}`,
      insertText: new SnippetString(
        prettyHTML("<" + snippets.join(""), { indent_size: this.size }).substr(
          1
        )
      ),
      kind: CompletionItemKind.Module,
      detail: tagVal.description,
      documentation: tagVal.docLink,
    };
  }

  buildAttrSuggestion(
    {
      attr,
      tag,
      bind,
      method,
    }: { attr: string; tag: string; bind: boolean; method: boolean },
    {
      description,
      type,
      optionType,
      defaultValue,
    }: {
      description: string | undefined;
      type: string | undefined;
      optionType: string | undefined;
      defaultValue: string | undefined;
    }
  ) {
    if (
      (method && type === "method") ||
      (bind && type !== "method") ||
      (!method && !bind)
    ) {
      let documentation = description;
      optionType && (documentation += "\n" + `type: ${optionType}`);
      defaultValue && (documentation += "\n" + `default: ${defaultValue}`);
      return {
        label: attr,
        insertText:
          type && type === "flag"
            ? `${attr} `
            : new SnippetString(`${attr}=${this.quotes}$1${this.quotes}$0`),
        kind:
          type && type === "method"
            ? CompletionItemKind.Method
            : CompletionItemKind.Field,
        detail: "Flow Design Vue",
        documentation,
      };
    } else {
      return;
    }
  }

  getAttrValues(tag: string, attr: string) {
    let attrItem = this.getAttrItem(tag, attr);
    let options = attrItem && attrItem.values;
    if (!options && attrItem) {
      if (attrItem.type === "boolean") {
        options = { true: {}, false: {} };
      }
    }
    return options || [];
  }

  getTagAttrs(tag: string) {
    let attrs = [];
    for (let attr in components[tag].attributes) {
      attrs.push(attr);
    }

    return attrs;
  }

  getAttrItem(
    tag: string | undefined,
    attr: string | undefined
  ): Partial<FlowElementAttributeMeta> {
    return tag && attr ? components[tag].attributes[attr] : {};
  }

  isAttrValueStart(tag: Object | string | undefined, attr: string) {
    return tag && attr;
  }

  isAttrStart(tag: TagObject | undefined) {
    return tag;
  }

  isTagStart() {
    let txt = this.getTextBeforePosition(this._position);
    return this.tagStartReg.test(txt);
  }

  firstCharsEqual(str1: string, str2: string) {
    if (str2 && str1) {
      return str1[0].toLowerCase() === str2[0].toLowerCase();
    }
    return false;
  }
  // tentative plan for vue file
  notInTemplate(): boolean {
    let line = this._position.line;
    while (line) {
      if (/^\s*<script.*>\s*$/.test(<string>this._document.lineAt(line).text)) {
        return true;
      }
      line--;
    }
    return false;
  }

  provideCompletionItems(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    completionContext: CompletionContext
  ): ProviderResult<CompletionItem[] | CompletionList> {
    this._document = document;
    this._position = position;
    this._triggerCharacter = completionContext.triggerCharacter;

    const config = workspace.getConfiguration("flow-helper");
    this.size = config.get("indent-size");
    const normalQuotes = config.get("quotes") === "double" ? '"' : "'";
    this.quotes = normalQuotes;

    let tag: TagObject | undefined = this.getPreTag();
    let attr = this.getPreAttr();
    if (this.isAttrValueStart(tag, attr)) {
      return this.getAttrValueSuggestion(tag ? tag.text : "", attr || "");
    } else if (this.isAttrStart(tag)) {
      return this.getAttrSuggestion(tag ? tag.text : "");
    } else if (this.isTagStart()) {
      switch (document.languageId) {
        case "vue":
          return this.notInTemplate() ? [] : this.getTagSuggestion();
        case "html":
          // todo
          return this.getTagSuggestion();
      }
    } else {
      return [];
    }
  }
}

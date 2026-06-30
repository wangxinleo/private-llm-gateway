"use client";

import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/themes/prism-okaidia.min.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
}

export function JsonEditor({ value, onChange, readOnly, placeholder, minHeight = 200, autoFocus }: Props) {
  if (readOnly) {
    return (
      <pre
        className="overflow-x-auto rounded-md border border-border/30 bg-muted/30 p-3 font-mono text-xs leading-relaxed"
        style={{ minHeight }}
        dangerouslySetInnerHTML={{
          __html: value
            ? highlight(value, languages.json, "json")
            : `<span class="token comment">${placeholder ?? ""}</span>`,
        }}
      />
    );
  }

  return (
    <div
      className="overflow-auto rounded-md border border-border/30 bg-muted/30"
      style={{ minHeight }}
    >
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={(code) => highlight(code, languages.json, "json")}
        padding={12}
        placeholder={placeholder}
        autoFocus={autoFocus}
        textareaClassName="json-editor-textarea"
        className="font-mono text-xs leading-relaxed"
        style={{
          fontFamily: "inherit",
          minHeight,
        }}
      />
    </div>
  );
}

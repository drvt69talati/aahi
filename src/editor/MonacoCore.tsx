import React, { useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface MonacoCoreProps {
  content: string;
  language: string;
  onChange?: (value: string | undefined) => void;
  onEditorMount?: (editor: editor.IStandaloneCodeEditor) => void;
}

const defaultEditorOptions: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
  fontLigatures: true,
  lineNumbers: 'on',
  minimap: { enabled: true, maxColumn: 80 },
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection',
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'off',
  bracketPairColorization: { enabled: true },
  autoClosingBrackets: 'always',
  autoClosingQuotes: 'always',
  suggestOnTriggerCharacters: true,
  quickSuggestions: true,
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  padding: { top: 8, bottom: 8 },
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  renderLineHighlight: 'gutter',
  guides: {
    indentation: true,
    bracketPairs: true,
  },
};

export const MonacoCore: React.FC<MonacoCoreProps> = ({
  content,
  language,
  onChange,
  onEditorMount,
}) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Register Cmd+K keybinding placeholder for inline prompt bar
      editor.addAction({
        id: 'aahi.inlinePrompt',
        label: 'Aahi: Inline Prompt',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
        run: () => {
          // Dispatch custom event for InlinePromptBar to pick up
          window.dispatchEvent(
            new CustomEvent('aahi:inline-prompt', {
              detail: {
                position: editor.getPosition(),
                selection: editor.getSelection(),
              },
            })
          );
        },
      });

      // Register Cmd+L keybinding to focus chat panel
      editor.addAction({
        id: 'aahi.focusChat',
        label: 'Aahi: Focus Chat',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
        run: () => {
          window.dispatchEvent(new CustomEvent('aahi:focus-chat'));
        },
      });

      onEditorMount?.(editor);
    },
    [onEditorMount]
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Editor
        defaultValue={content}
        language={language}
        theme="vs-dark"
        options={defaultEditorOptions}
        onChange={onChange}
        onMount={handleMount}
      />
    </div>
  );
};

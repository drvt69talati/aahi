import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor, languages, Position, CancellationToken } from 'monaco-editor';
import { useRuntimeStore } from '../store/runtime-store';
import { EditorContextMenu } from './EditorContextMenu';

/* ── Extension → Monaco language mapping ── */
const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  json: 'json',
  md: 'markdown',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const basename = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (basename === 'dockerfile') return 'dockerfile';
  return EXT_LANG_MAP[ext] ?? 'plaintext';
}

/* ── Editor options ── */
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
  guides: { indentation: true, bracketPairs: true },
  inlineSuggest: { enabled: true },
};

/* ── Welcome screen ── */
const WelcomeScreen: React.FC = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      width: '100%',
      backgroundColor: '#1e1e1e',
      color: '#858585',
      userSelect: 'none',
    }}
  >
    <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>Aahi</div>
    <div style={{ fontSize: 14, marginBottom: 24 }}>AI-native Software Operations Platform</div>
    <div style={{ fontSize: 12, lineHeight: 2, textAlign: 'center', color: '#585858' }}>
      <div>Cmd+O &mdash; Open File</div>
      <div>Cmd+Shift+P &mdash; Command Palette</div>
      <div>Cmd+K &mdash; Inline AI Prompt</div>
      <div>Cmd+L &mdash; Focus AI Chat</div>
    </div>
  </div>
);

/* ── Main component ── */
export const MonacoCore: React.FC = () => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<any>(null);
  const disposablesRef = useRef<any[]>([]);
  const fimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    selectedText: string;
    line: number;
    column: number;
  }>({ visible: false, x: 0, y: 0, selectedText: '', line: 0, column: 0 });

  const activeFilePath = useRuntimeStore((s) => s.activeFilePath);
  const openFiles = useRuntimeStore((s) => s.openFiles);
  const saveFile = useRuntimeStore((s) => s.saveFile);
  const requestCompletion = useRuntimeStore((s) => s.requestCompletion);
  const getCompletions = useRuntimeStore((s) => s.getCompletions);
  const getHover = useRuntimeStore((s) => s.getHover);
  const getDefinition = useRuntimeStore((s) => s.getDefinition);

  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : undefined;
  const content = activeFile?.content ?? '';
  const language = activeFilePath ? detectLanguage(activeFilePath) : 'plaintext';

  /* ── Mark file dirty on content change ── */
  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!activeFilePath || value === undefined) return;
      const store = useRuntimeStore.getState();
      const file = store.openFiles.get(activeFilePath);
      if (file) {
        store.openFiles.set(activeFilePath, { ...file, content: value, dirty: true });
        // Trigger a shallow re-render for subscribers
        useRuntimeStore.setState({ openFiles: new Map(store.openFiles) });
      }
    },
    [activeFilePath]
  );

  /* ── Register LSP + FIM providers (once on mount) ── */
  const registerProviders = useCallback(
    (monaco: any) => {
      // Dispose previous
      disposablesRef.current.forEach((d) => d.dispose());
      disposablesRef.current = [];

      /* Completion provider (LSP) */
      const compProvider = monaco.languages.registerCompletionItemProvider('*', {
        triggerCharacters: ['.', ':', '<', '"', "'", '/', '@', '#'],
        provideCompletionItems: async (
          model: editor.ITextModel,
          position: Position,
          _ctx: languages.CompletionContext,
          _token: CancellationToken
        ) => {
          try {
            const items = await getCompletions(
              model.uri.toString(),
              position.lineNumber,
              position.column
            );
            return {
              suggestions: (items ?? []).map((item: any, i: number) => ({
                label: item.label ?? item.text ?? '',
                kind: item.kind ?? monaco.languages.CompletionItemKind.Text,
                insertText: item.insertText ?? item.text ?? item.label ?? '',
                detail: item.detail,
                documentation: item.documentation,
                sortText: String(i).padStart(5, '0'),
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                },
              })),
            };
          } catch {
            return { suggestions: [] };
          }
        },
      });
      disposablesRef.current.push(compProvider);

      /* Hover provider (LSP) */
      const hoverProvider = monaco.languages.registerHoverProvider('*', {
        provideHover: async (
          model: editor.ITextModel,
          position: Position,
          _token: CancellationToken
        ) => {
          try {
            const result = await getHover(
              model.uri.toString(),
              position.lineNumber,
              position.column
            );
            if (!result) return null;
            return {
              contents: [
                {
                  value: typeof result === 'string' ? result : result.contents ?? '',
                },
              ],
              range: result.range ?? undefined,
            };
          } catch {
            return null;
          }
        },
      });
      disposablesRef.current.push(hoverProvider);

      /* Definition provider (LSP) */
      const defProvider = monaco.languages.registerDefinitionProvider('*', {
        provideDefinition: async (
          model: editor.ITextModel,
          position: Position,
          _token: CancellationToken
        ) => {
          try {
            const result = await getDefinition(
              model.uri.toString(),
              position.lineNumber,
              position.column
            );
            if (!result) return null;
            if (Array.isArray(result)) {
              return result.map((loc: any) => ({
                uri: monaco.Uri.parse(loc.uri),
                range: loc.range,
              }));
            }
            return {
              uri: monaco.Uri.parse(result.uri),
              range: result.range,
            };
          } catch {
            return null;
          }
        },
      });
      disposablesRef.current.push(defProvider);

      /* FIM inline completion provider */
      const inlineProvider = monaco.languages.registerInlineCompletionsProvider('*', {
        provideInlineCompletions: async (
          model: editor.ITextModel,
          position: Position,
          _ctx: languages.InlineCompletionContext,
          _token: CancellationToken
        ) => {
          try {
            const textUntilPosition = model.getValueInRange({
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            });
            const textAfterPosition = model.getValueInRange({
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: model.getLineCount(),
              endColumn: model.getLineMaxColumn(model.getLineCount()),
            });

            const lang = detectLanguage(activeFilePath ?? '');
            const completion = await requestCompletion(
              textUntilPosition,
              textAfterPosition,
              lang,
              position.lineNumber,
              position.column
            );

            if (!completion) return { items: [] };

            const text = typeof completion === 'string' ? completion : completion.text ?? '';
            if (!text) return { items: [] };

            return {
              items: [
                {
                  insertText: text,
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column,
                  },
                },
              ],
            };
          } catch {
            return { items: [] };
          }
        },
        freeInlineCompletions: () => {},
      });
      disposablesRef.current.push(inlineProvider);
    },
    [getCompletions, getHover, getDefinition, requestCompletion, activeFilePath]
  );

  /* ── Handle editor mount ── */
  const handleMount: OnMount = useCallback(
    (editorInstance, monaco) => {
      editorRef.current = editorInstance;
      monacoRef.current = monaco;

      // Register providers
      registerProviders(monaco);

      /* Cmd+S — save file */
      editorInstance.addAction({
        id: 'aahi.saveFile',
        label: 'Aahi: Save File',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          const path = useRuntimeStore.getState().activeFilePath;
          if (!path) return;
          const file = useRuntimeStore.getState().openFiles.get(path);
          if (!file) return;
          saveFile(path, file.content);
          // Mark clean
          const store = useRuntimeStore.getState();
          const current = store.openFiles.get(path);
          if (current) {
            store.openFiles.set(path, { ...current, dirty: false });
            useRuntimeStore.setState({ openFiles: new Map(store.openFiles) });
          }
        },
      });

      /* Cmd+K — Inline prompt */
      editorInstance.addAction({
        id: 'aahi.inlinePrompt',
        label: 'Aahi: Inline Prompt',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
        run: () => {
          window.dispatchEvent(
            new CustomEvent('aahi:inline-prompt', {
              detail: {
                position: editorInstance.getPosition(),
                selection: editorInstance.getSelection(),
              },
            })
          );
        },
      });

      /* Cmd+L — Focus chat */
      editorInstance.addAction({
        id: 'aahi.focusChat',
        label: 'Aahi: Focus Chat',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
        run: () => {
          window.dispatchEvent(new CustomEvent('aahi:focus-chat'));
        },
      });

      /* Context menu — show Aahi custom menu on right-click */
      editorInstance.onContextMenu((e: any) => {
        e.event.preventDefault();
        e.event.stopPropagation();
        const selection = editorInstance.getSelection();
        const selectedText = selection
          ? editorInstance.getModel()?.getValueInRange(selection) ?? ''
          : '';
        const pos = editorInstance.getPosition();
        setContextMenu({
          visible: true,
          x: e.event.posx,
          y: e.event.posy,
          selectedText,
          line: pos?.lineNumber ?? 1,
          column: pos?.column ?? 1,
        });
      });

      /* Listen for editor actions dispatched from context menu */
      const editorActionHandler = (evt: Event) => {
        const action = (evt as CustomEvent).detail?.action;
        if (action && editorInstance.getAction(action)) {
          editorInstance.getAction(action)?.run();
        } else if (action) {
          editorInstance.trigger('aahi-ctx', action, {});
        }
      };
      window.addEventListener('aahi:editor-action', editorActionHandler);
      disposablesRef.current.push({
        dispose: () => window.removeEventListener('aahi:editor-action', editorActionHandler),
      });

      /* Debounced FIM trigger on cursor position change */
      editorInstance.onDidChangeCursorPosition(() => {
        if (fimTimerRef.current) clearTimeout(fimTimerRef.current);
        fimTimerRef.current = setTimeout(() => {
          // Trigger inline completions
          editorInstance.trigger('aahi-fim', 'editor.action.inlineSuggest.trigger', {});
        }, 300);
      });
    },
    [registerProviders, saveFile]
  );

  /* ── Sync content when active file changes ── */
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco || !activeFilePath) return;

    const model = ed.getModel();
    if (model) {
      const currentValue = model.getValue();
      if (currentValue !== content) {
        model.setValue(content);
      }
      // Update language
      monaco.editor.setModelLanguage(model, language);
    }
  }, [activeFilePath, content, language]);

  /* Cleanup */
  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((d) => d.dispose());
      disposablesRef.current = [];
      if (fimTimerRef.current) clearTimeout(fimTimerRef.current);
    };
  }, []);

  /* ── Render ── */
  if (!activeFilePath) {
    return <WelcomeScreen />;
  }

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Editor
        key={activeFilePath}
        defaultValue={content}
        language={language}
        theme="vs-dark"
        options={{ ...defaultEditorOptions, contextmenu: false }}
        onChange={handleChange}
        onMount={handleMount}
      />
      <EditorContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        selectedText={contextMenu.selectedText}
        filePath={activeFilePath ?? ''}
        line={contextMenu.line}
        column={contextMenu.column}
        onClose={handleCloseContextMenu}
      />
    </div>
  );
};

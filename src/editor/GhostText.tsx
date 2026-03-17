import { useEffect, useRef, useCallback } from 'react';
import type { editor, IDisposable } from 'monaco-editor';

interface GhostTextState {
  decorationIds: string[];
  completionText: string;
  position: { lineNumber: number; column: number } | null;
  visible: boolean;
}

/**
 * useGhostText — manages FIM (Fill-in-the-Middle) inline ghost text completions.
 *
 * Renders ghost text as dimmed inline decorations in Monaco.
 * - Tab: accept full completion
 * - Ctrl+Right / Cmd+Right: accept word-by-word
 * - Escape: dismiss
 */
export function useGhostText(editorInstance: editor.IStandaloneCodeEditor | null) {
  const stateRef = useRef<GhostTextState>({
    decorationIds: [],
    completionText: '',
    position: null,
    visible: false,
  });
  const disposablesRef = useRef<IDisposable[]>([]);

  const clearGhostText = useCallback(() => {
    if (!editorInstance) return;
    const state = stateRef.current;
    if (state.decorationIds.length > 0) {
      editorInstance.removeDecorations(state.decorationIds);
      state.decorationIds = [];
    }
    state.visible = false;
    state.completionText = '';
    state.position = null;
  }, [editorInstance]);

  const showGhostText = useCallback(
    (text: string, position: { lineNumber: number; column: number }) => {
      if (!editorInstance) return;
      clearGhostText();

      const state = stateRef.current;
      state.completionText = text;
      state.position = position;
      state.visible = true;

      // Use inline decorations to show ghost text in a dimmed style
      const decorations: editor.IModelDeltaDecoration[] = [
        {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
          options: {
            after: {
              content: text,
              inlineClassName: 'aahi-ghost-text',
            },
          },
        },
      ];

      state.decorationIds = editorInstance.deltaDecorations([], decorations);
    },
    [editorInstance, clearGhostText]
  );

  const acceptFull = useCallback(() => {
    if (!editorInstance) return;
    const state = stateRef.current;
    if (!state.visible || !state.position) return;

    const model = editorInstance.getModel();
    if (!model) return;

    // Insert the completion text
    editorInstance.executeEdits('ghost-text-accept', [
      {
        range: {
          startLineNumber: state.position.lineNumber,
          startColumn: state.position.column,
          endLineNumber: state.position.lineNumber,
          endColumn: state.position.column,
        },
        text: state.completionText,
      },
    ]);

    clearGhostText();
  }, [editorInstance, clearGhostText]);

  const acceptWord = useCallback(() => {
    if (!editorInstance) return;
    const state = stateRef.current;
    if (!state.visible || !state.position || !state.completionText) return;

    // Extract first word (including trailing whitespace)
    const match = state.completionText.match(/^(\S+\s*)/);
    if (!match) return;

    const word = match[1];
    const remaining = state.completionText.slice(word.length);

    const model = editorInstance.getModel();
    if (!model) return;

    editorInstance.executeEdits('ghost-text-accept-word', [
      {
        range: {
          startLineNumber: state.position.lineNumber,
          startColumn: state.position.column,
          endLineNumber: state.position.lineNumber,
          endColumn: state.position.column,
        },
        text: word,
      },
    ]);

    if (remaining) {
      const newCol = state.position.column + word.length;
      showGhostText(remaining, {
        lineNumber: state.position.lineNumber,
        column: newCol,
      });
    } else {
      clearGhostText();
    }
  }, [editorInstance, clearGhostText, showGhostText]);

  // Register keybindings
  useEffect(() => {
    if (!editorInstance) return;

    // Inject CSS for ghost text styling
    const styleId = 'aahi-ghost-text-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .aahi-ghost-text {
          color: #858585 !important;
          font-style: italic;
          opacity: 0.6;
        }
      `;
      document.head.appendChild(style);
    }

    const monaco = (window as any).monaco;
    if (!monaco) return;

    // Tab to accept full completion
    const tabDisposable = editorInstance.addAction({
      id: 'aahi.ghostText.acceptFull',
      label: 'Accept Ghost Text',
      keybindings: [monaco.KeyCode.Tab],
      precondition: undefined,
      run: () => {
        if (stateRef.current.visible) {
          acceptFull();
        } else {
          // Let default tab behavior through
          editorInstance.trigger('keyboard', 'tab', null);
        }
      },
    });

    // Escape to dismiss
    const escDisposable = editorInstance.addAction({
      id: 'aahi.ghostText.dismiss',
      label: 'Dismiss Ghost Text',
      keybindings: [monaco.KeyCode.Escape],
      run: () => {
        if (stateRef.current.visible) {
          clearGhostText();
        }
      },
    });

    // Ctrl+Right to accept word
    const wordDisposable = editorInstance.addAction({
      id: 'aahi.ghostText.acceptWord',
      label: 'Accept Ghost Text Word',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow],
      run: () => {
        if (stateRef.current.visible) {
          acceptWord();
        } else {
          editorInstance.trigger('keyboard', 'cursorWordEndRight', null);
        }
      },
    });

    disposablesRef.current = [tabDisposable, escDisposable, wordDisposable];

    return () => {
      disposablesRef.current.forEach((d) => d.dispose());
      disposablesRef.current = [];
    };
  }, [editorInstance, acceptFull, acceptWord, clearGhostText]);

  return {
    showGhostText,
    clearGhostText,
    acceptFull,
    acceptWord,
    isVisible: () => stateRef.current.visible,
  };
}

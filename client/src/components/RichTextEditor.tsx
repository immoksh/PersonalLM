import { useCallback } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { LinkIcon } from './icons';
import { cx } from './ui';

interface RichTextEditorProps {
  /** Initial HTML. Treated as uncontrolled — later changes are ignored. */
  initialHtml?: string;
  placeholder?: string;
  onChange: (value: { html: string; text: string; isEmpty: boolean }) => void;
}

interface ToolbarButton {
  label: string;
  content: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const BUTTONS: ToolbarButton[][] = [
  [
    {
      label: 'Bold',
      content: 'B',
      isActive: (e) => e.isActive('bold'),
      run: (e) => e.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      content: 'I',
      isActive: (e) => e.isActive('italic'),
      run: (e) => e.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Strikethrough',
      content: 'S',
      isActive: (e) => e.isActive('strike'),
      run: (e) => e.chain().focus().toggleStrike().run(),
    },
    {
      label: 'Inline code',
      content: '</>',
      isActive: (e) => e.isActive('code'),
      run: (e) => e.chain().focus().toggleCode().run(),
    },
  ],
  [
    {
      label: 'Heading 1',
      content: 'H1',
      isActive: (e) => e.isActive('heading', { level: 1 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: 'Heading 2',
      content: 'H2',
      isActive: (e) => e.isActive('heading', { level: 2 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
  ],
  [
    {
      label: 'Bullet list',
      content: '••',
      isActive: (e) => e.isActive('bulletList'),
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      content: '1.',
      isActive: (e) => e.isActive('orderedList'),
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Quote',
      content: '❝',
      isActive: (e) => e.isActive('blockquote'),
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      label: 'Code block',
      content: '{ }',
      isActive: (e) => e.isActive('codeBlock'),
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
  ],
];

/** WYSIWYG editor for plain-text sources, built on TipTap. */
export function RichTextEditor({ initialHtml = '', placeholder, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Links are inserted through the toolbar, and must never be javascript:.
        link: { openOnClick: false, autolink: true, protocols: ['http', 'https'] },
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Start writing…' }),
    ],
    content: initialHtml,
    onUpdate: ({ editor: instance }) => {
      onChange({
        html: instance.getHTML(),
        text: instance.getText(),
        isEmpty: instance.isEmpty,
      });
    },
    editorProps: {
      attributes: { class: 'tiptap', role: 'textbox', 'aria-multiline': 'true' },
    },
  });

  const setLink = useCallback(() => {
    if (!editor) return;

    const existing = editor.getAttributes('link').href as string | undefined;
    const input = window.prompt('Link URL', existing ?? 'https://');

    if (input === null) return; // Cancelled.
    if (input.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    const href = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
    try {
      new URL(href);
    } catch {
      return; // Silently ignore unparseable input rather than storing junk.
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }, [editor]);

  if (!editor) {
    return <div className="h-64 animate-pulse rounded-xl border border-border bg-surface-2" />;
  }

  const buttonClass = (active: boolean) =>
    cx(
      'grid h-8 min-w-8 place-items-center rounded-md px-2 text-xs font-semibold transition',
      active ? 'bg-neon text-neon-ink' : 'text-muted hover:bg-surface hover:text-text',
    );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-2 focus-within:border-neon">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
        {BUTTONS.map((group, index) => (
          <div key={index} className="flex items-center gap-0.5">
            {index > 0 && <span className="mx-1 h-5 w-px bg-border" aria-hidden />}
            {group.map((button) => (
              <button
                key={button.label}
                type="button"
                title={button.label}
                aria-label={button.label}
                aria-pressed={button.isActive(editor)}
                // Keep the caret and selection in the document: without this the
                // button takes focus on mousedown and the selection collapses,
                // so formatting applies to nothing.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => button.run(editor)}
                className={buttonClass(button.isActive(editor))}
              >
                {button.content}
              </button>
            ))}
          </div>
        ))}

        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <button
          type="button"
          title="Add link"
          aria-label="Add link"
          aria-pressed={editor.isActive('link')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={setLink}
          className={buttonClass(editor.isActive('link'))}
        >
          <LinkIcon className="size-4" />
        </button>
      </div>

      <EditorContent editor={editor} className="max-h-[45vh] overflow-y-auto" />
    </div>
  );
}

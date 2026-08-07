import type { Editor } from "@tiptap/core";

let uploadCounter = 0;

/** Shared by the toolbar's "Insert image" button and the slash command's "Image" item so
 * there's exactly one implementation of "insert now, resolve later": places a local
 * object-URL preview at the cursor immediately (tagged `uploading`/`uploadId`), uploads the
 * file in the background via the caller-supplied `onUploadFile`, then swaps that same node's
 * `src` in for the real URL once it resolves — or removes it if the upload failed. Finding
 * the node by `uploadId` (rather than a saved position) stays correct even if the user keeps
 * typing/moves the cursor while the upload is in flight. */
export function insertImageWithUpload(editor: Editor, onUploadFile: (file: File) => Promise<string | null>): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    const uploadId = `upload-${Date.now()}-${uploadCounter++}`;
    const objectUrl = URL.createObjectURL(file);
    editor.chain().focus().insertContent({
      type: "image",
      attrs: { src: objectUrl, alt: "", uploading: true, uploadId },
    }).run();

    try {
      const url = await onUploadFile(file);
      if (url) {
        setImageNodeAttrs(editor, uploadId, { src: url, uploading: false, uploadId: null });
      } else {
        removeImageNode(editor, uploadId);
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };
  input.click();
}

function findImageNodePos(editor: Editor, uploadId: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "image" && node.attrs.uploadId === uploadId) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function setImageNodeAttrs(editor: Editor, uploadId: string, attrs: Record<string, unknown>): void {
  const pos = findImageNodePos(editor, uploadId);
  if (pos === null) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}

function removeImageNode(editor: Editor, uploadId: string): void {
  const pos = findImageNodePos(editor, uploadId);
  if (pos === null) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
}

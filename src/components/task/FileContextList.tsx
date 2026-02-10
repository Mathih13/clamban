import { useState } from "react";
import { ExternalLink, FileCode2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FileContext } from "@/types/board";

interface FileContextListProps {
  files: FileContext[];
  onUpdate: (files: FileContext[]) => void;
}

export function FileContextList({ files, onUpdate }: FileContextListProps) {
  const [newPath, setNewPath] = useState("");
  const [newNote, setNewNote] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newPath.trim()) return;
    onUpdate([...files, { path: newPath.trim(), note: newNote.trim() || undefined }]);
    setNewPath("");
    setNewNote("");
  }

  function handleRemove(index: number) {
    onUpdate(files.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {files.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No file references yet
        </p>
      )}
      {files.map((file, i) => {
        const absPath = file.path.startsWith("/") ? file.path : null;
        const vscodeUri = absPath ? `vscode://file${absPath}` : null;
        return (
          <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
            <FileCode2 className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              {vscodeUri ? (
                <a
                  href={vscodeUri}
                  className="text-sm font-mono truncate block text-blue-400 hover:text-blue-300 hover:underline"
                  title={`Open ${file.path} in VS Code`}
                >
                  {file.path}
                </a>
              ) : (
                <p className="text-sm font-mono truncate">{file.path}</p>
              )}
              {file.note && (
                <p className="text-xs text-muted-foreground mt-0.5">{file.note}</p>
              )}
            </div>
            {vscodeUri && (
              <a
                href={vscodeUri}
                className="shrink-0 text-muted-foreground hover:text-blue-400 transition-colors"
                title="Open in VS Code"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
            <button
              onClick={() => handleRemove(i)}
              className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
      <form onSubmit={handleAdd} className="flex flex-col gap-2 mt-2">
        <Input
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          placeholder="File path..."
          className="font-mono text-sm"
        />
        <div className="flex gap-2">
          <Input
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Note (optional)"
            className="flex-1"
          />
          <Button type="submit" size="sm" disabled={!newPath.trim()}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </form>
    </div>
  );
}

function classForLine(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground";
  if (line.startsWith("+")) return "bg-green-500/10 text-green-400";
  if (line.startsWith("-")) return "bg-red-500/10 text-red-400";
  if (line.startsWith("@@")) return "text-blue-400 font-semibold mt-2 select-none";
  if (line.startsWith("diff --git"))
    return "text-foreground font-bold mt-4 border-t border-border pt-2";
  return "text-muted-foreground";
}

interface DiffViewerProps {
  diff: string;
}

export function DiffViewer({ diff }: DiffViewerProps) {
  if (!diff.trim()) {
    return <p className="text-sm text-muted-foreground text-center py-6">No changes</p>;
  }

  const lines = diff.split("\n");

  return (
    <div className="max-h-[500px] overflow-auto rounded-md border bg-zinc-950">
      <pre className="p-3 text-[11px] font-mono leading-relaxed min-w-max">
        {lines.map((line, i) => (
          <div key={i} className={`px-2 ${classForLine(line)}`}>
            {line || "\u00A0"}
          </div>
        ))}
      </pre>
    </div>
  );
}

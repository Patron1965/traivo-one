import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
const mod = isMac ? "⌘" : "Ctrl";

const shortcutGroups = [
  {
    title: "Navigering",
    shortcuts: [
      { keys: `${mod} + K`, description: "Öppna snabbsök" },
      { keys: `${mod} + B`, description: "Visa/dölj sidopanel" },
      { keys: "?", description: "Visa tangentbordsgenvägar" },
    ],
  },
  {
    title: "Veckoplanering",
    shortcuts: [
      { keys: `${mod} + Z`, description: "Ångra senaste ändring" },
      { keys: `${mod} + Y`, description: "Gör om senaste ändring" },
    ],
  },
  {
    title: "Utseende",
    shortcuts: [
      { keys: `${mod} + T`, description: "Växla mörkt/ljust tema" },
    ],
  },
  {
    title: "Allmänt",
    shortcuts: [
      { keys: "Esc", description: "Stäng dialoger och paneler" },
    ],
  },
];

export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "?" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-keyboard-shortcuts">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Tangentbordsgenvägar
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                {group.title}
              </h4>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between py-1"
                    data-testid={`shortcut-${shortcut.keys.replace(/\s/g, "")}`}
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <kbd className="pointer-events-none inline-flex h-6 select-none items-center gap-1 rounded border bg-muted px-2 font-mono text-xs font-medium text-muted-foreground">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

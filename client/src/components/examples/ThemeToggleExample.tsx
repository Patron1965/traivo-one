import { ThemeToggle } from "../ThemeToggle";

export default function ThemeToggleExample() {
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm">Byt tema:</span>
      <ThemeToggle />
    </div>
  );
}

import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
  testId?: string;
}

export function PageHeader({ icon: Icon, title, description, children, testId }: PageHeaderProps) {
  return (
    <div className="rounded-xl bg-gradient-to-r from-[#1B4B6B]/8 via-[#4A9B9B]/6 to-[#7DBFB0]/8 dark:from-[#1B4B6B]/20 dark:via-[#4A9B9B]/15 dark:to-[#7DBFB0]/20 border border-[#1B4B6B]/10 dark:border-[#4A9B9B]/20 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          {Icon && (
            <div className="p-2 rounded-lg bg-[#1B4B6B]/10 dark:bg-[#4A9B9B]/20 mt-0.5">
              <Icon className="h-5 w-5 text-[#1B4B6B] dark:text-[#4A9B9B]" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid={testId || "text-page-title"}>
              {title}
            </h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            )}
          </div>
        </div>
        {children && (
          <div className="flex items-center gap-2 flex-wrap">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

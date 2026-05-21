import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X, ChevronDown, Check } from "lucide-react";

interface ResourceFilterBarProps {
  resourceNameFilter: string;
  setResourceNameFilter: (v: string) => void;
  resourceExecutionCodeFilter: string[];
  setResourceExecutionCodeFilter: (v: string[]) => void;
  resourceOccupancyFilter: "all" | "free" | "loaded" | "overloaded";
  setResourceOccupancyFilter: (v: "all" | "free" | "loaded" | "overloaded") => void;
  filterTeam: string;
  setFilterTeam: (v: string) => void;
  teamsData: Array<{ id: string; name: string; clusterId: string | null; color: string | null }>;
  allExecutionCodes: string[];
  resourceActiveFilterCount: number;
  clearResourceFilters: () => void;
  showRowModeToggle?: boolean;
  weekRowMode?: "team" | "resource";
  setWeekRowMode?: (mode: "team" | "resource") => void;
  selectedTeamIds?: string[];
  setSelectedTeamIds?: (ids: string[]) => void;
}

const occupancyOptions: Array<{ value: "all" | "free" | "loaded" | "overloaded"; label: string }> = [
  { value: "all", label: "Alla" },
  { value: "free", label: "Ledig (<60%)" },
  { value: "loaded", label: "Belastad (60–90%)" },
  { value: "overloaded", label: "Överbelastad (>90%)" },
];

export function ResourceFilterBar({
  resourceNameFilter,
  setResourceNameFilter,
  resourceExecutionCodeFilter,
  setResourceExecutionCodeFilter,
  resourceOccupancyFilter,
  setResourceOccupancyFilter,
  filterTeam,
  setFilterTeam,
  teamsData,
  allExecutionCodes,
  resourceActiveFilterCount,
  clearResourceFilters,
  showRowModeToggle,
  weekRowMode,
  setWeekRowMode,
  selectedTeamIds = [],
  setSelectedTeamIds,
}: ResourceFilterBarProps) {
  const isTeamMode = showRowModeToggle && weekRowMode === "team";
  const toggleSelectedTeam = (id: string) => {
    if (!setSelectedTeamIds) return;
    if (selectedTeamIds.includes(id)) setSelectedTeamIds(selectedTeamIds.filter(t => t !== id));
    else setSelectedTeamIds([...selectedTeamIds, id]);
  };
  const toggleExecutionCode = (code: string) => {
    if (resourceExecutionCodeFilter.includes(code)) {
      setResourceExecutionCodeFilter(resourceExecutionCodeFilter.filter(c => c !== code));
    } else {
      setResourceExecutionCodeFilter([...resourceExecutionCodeFilter, code]);
    }
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b bg-muted/20 flex-wrap" data-testid="resource-filter-bar">
      {showRowModeToggle && setWeekRowMode && (
        <div className="flex items-center gap-1 mr-1" data-testid="row-mode-toggle">
          <span className="text-[11px] text-muted-foreground">Visa:</span>
          <div className="inline-flex h-7 rounded-md border bg-background overflow-hidden">
            <button
              type="button"
              onClick={() => setWeekRowMode("team")}
              className={`px-2 text-xs ${weekRowMode === "team" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              data-testid="button-row-mode-team"
            >
              Team
            </button>
            <button
              type="button"
              onClick={() => setWeekRowMode("resource")}
              className={`px-2 text-xs border-l ${weekRowMode === "resource" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              data-testid="button-row-mode-resource"
            >
              Resurs
            </button>
          </div>
        </div>
      )}

      {!isTeamMode && (
        <div className="relative flex-shrink-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          <Input
            value={resourceNameFilter}
            onChange={e => setResourceNameFilter(e.target.value)}
            placeholder="Sök resurs..."
            className="h-7 pl-6 pr-2 text-xs w-36"
            data-testid="input-resource-name-filter"
          />
          {resourceNameFilter && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setResourceNameFilter("")}
              data-testid="clear-resource-name-filter"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {teamsData.length > 0 && !isTeamMode && (
        <Select value={filterTeam} onValueChange={setFilterTeam}>
          <SelectTrigger className="h-7 text-xs w-32" data-testid="select-resource-team-filter">
            <SelectValue placeholder="Team" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla team</SelectItem>
            {teamsData.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {teamsData.length > 0 && isTeamMode && setSelectedTeamIds && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2 gap-1"
              data-testid="button-team-multi-filter"
            >
              <span>Team</span>
              {selectedTeamIds.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">{selectedTeamIds.length}</Badge>
              )}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="start">
            <div className="space-y-0.5">
              <button
                onClick={() => setSelectedTeamIds([])}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                data-testid="team-multi-option-all"
              >
                <div className={`h-3.5 w-3.5 rounded border flex items-center justify-center flex-shrink-0 ${selectedTeamIds.length === 0 ? "bg-primary border-primary" : "border-input"}`}>
                  {selectedTeamIds.length === 0 && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </div>
                <span>Alla team</span>
              </button>
              {teamsData.map(t => (
                <button
                  key={t.id}
                  onClick={() => toggleSelectedTeam(t.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                  data-testid={`team-multi-option-${t.id}`}
                >
                  <div className={`h-3.5 w-3.5 rounded border flex items-center justify-center flex-shrink-0 ${selectedTeamIds.includes(t.id) ? "bg-primary border-primary" : "border-input"}`}>
                    {selectedTeamIds.includes(t.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  {t.color && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />}
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {!isTeamMode && allExecutionCodes.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2 gap-1"
              data-testid="button-execution-code-filter"
            >
              <span>Utförandekod</span>
              {resourceExecutionCodeFilter.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">{resourceExecutionCodeFilter.length}</Badge>
              )}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            <div className="space-y-0.5">
              {allExecutionCodes.map(code => (
                <button
                  key={code}
                  onClick={() => toggleExecutionCode(code)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                  data-testid={`execution-code-option-${code}`}
                >
                  <div className={`h-3.5 w-3.5 rounded border flex items-center justify-center flex-shrink-0 ${resourceExecutionCodeFilter.includes(code) ? "bg-primary border-primary" : "border-input"}`}>
                    {resourceExecutionCodeFilter.includes(code) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  <span className="truncate">{code}</span>
                </button>
              ))}
              {allExecutionCodes.length === 0 && (
                <p className="text-xs text-muted-foreground px-2 py-1">Inga koder tillgängliga</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {!isTeamMode && (
        <Select value={resourceOccupancyFilter} onValueChange={v => setResourceOccupancyFilter(v as "all" | "free" | "loaded" | "overloaded")}>
          <SelectTrigger className="h-7 text-xs w-40" data-testid="select-resource-occupancy-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {occupancyOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {resourceActiveFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
          onClick={clearResourceFilters}
          data-testid="button-clear-resource-filters"
        >
          <X className="h-3 w-3 mr-1" />
          Rensa ({resourceActiveFilterCount})
        </Button>
      )}
    </div>
  );
}

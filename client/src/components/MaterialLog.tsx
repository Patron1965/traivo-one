import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Package } from "lucide-react";

export interface MaterialItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
}

interface MaterialLogProps {
  materials: MaterialItem[];
  onMaterialsChange: (materials: MaterialItem[]) => void;
  readOnly?: boolean;
}

const COMMON_UNITS = [
  { value: "st", label: "st" },
  { value: "m", label: "meter" },
  { value: "kg", label: "kg" },
  { value: "l", label: "liter" },
  { value: "tim", label: "timmar" },
];

const COMMON_MATERIALS = [
  "Avfallssäck 125L",
  "Avfallssäck 240L",
  "Containerlås",
  "Hjul (kärl)",
  "Lock (kärl)",
  "Etiketter",
  "Rengöringsmedel",
  "Handtag",
  "Fotpedal",
];

export function MaterialLog({ materials, onMaterialsChange, readOnly = false }: MaterialLogProps) {
  const [newName, setNewName] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newUnit, setNewUnit] = useState("st");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredSuggestions = COMMON_MATERIALS.filter(
    (m) => m.toLowerCase().includes(newName.toLowerCase()) && newName.length > 0
  );

  const addMaterial = () => {
    if (!newName.trim() || !newQuantity) return;
    
    const quantity = parseFloat(newQuantity);
    if (isNaN(quantity) || quantity <= 0) return;

    const newItem: MaterialItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: newName.trim(),
      quantity,
      unit: newUnit,
    };

    onMaterialsChange([...materials, newItem]);
    setNewName("");
    setNewQuantity("1");
    setNewUnit("st");
  };

  const removeMaterial = (id: string) => {
    onMaterialsChange(materials.filter((m) => m.id !== id));
  };

  const selectSuggestion = (suggestion: string) => {
    setNewName(suggestion);
    setShowSuggestions(false);
  };

  if (readOnly) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Använt material
          </CardTitle>
        </CardHeader>
        <CardContent>
          {materials.length === 0 ? (
            <p className="text-sm text-muted-foreground">Inget material rapporterat</p>
          ) : (
            <div className="space-y-2">
              {materials.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-1 border-b last:border-0"
                  data-testid={`material-item-${item.id}`}
                >
                  <span className="text-sm">{item.name}</span>
                  <Badge variant="secondary">
                    {item.quantity} {item.unit}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="h-4 w-4" />
          Materialrapport
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-5 relative">
            <Input
              placeholder="Material..."
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              data-testid="input-material-name"
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-popover border rounded-md shadow-md max-h-40 overflow-auto">
                {filteredSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                    onMouseDown={() => selectSuggestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="col-span-2">
            <Input
              type="number"
              min="0.1"
              step="0.1"
              placeholder="Antal"
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.target.value)}
              data-testid="input-material-quantity"
            />
          </div>
          <div className="col-span-3">
            <Select value={newUnit} onValueChange={setNewUnit}>
              <SelectTrigger data-testid="select-material-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_UNITS.map((unit) => (
                  <SelectItem key={unit.value} value={unit.value}>
                    {unit.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Button
              size="icon"
              onClick={addMaterial}
              disabled={!newName.trim()}
              data-testid="button-add-material"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {materials.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            {materials.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 py-1"
                data-testid={`material-item-${item.id}`}
              >
                <span className="text-sm flex-1 truncate">{item.name}</span>
                <Badge variant="secondary" className="shrink-0">
                  {item.quantity} {item.unit}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => removeMaterial(item.id)}
                  data-testid={`button-remove-material-${item.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {materials.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Lägg till material som använts på jobbet
          </p>
        )}
      </CardContent>
    </Card>
  );
}

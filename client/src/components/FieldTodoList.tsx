import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Plus, Trash2, CheckCircle, Circle, ListTodo,
} from "lucide-react";

const STORAGE_KEY = "traivo_go_personal_todos";

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

function loadTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TodoItem[];
  } catch {
    return [];
  }
}

function saveTodos(items: TodoItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage unavailable
  }
}

export function getUncompletedTodoCount(): number {
  return loadTodos().filter(t => !t.completed).length;
}

interface FieldTodoListProps {
  onBack: () => void;
}

export function FieldTodoList({ onBack }: FieldTodoListProps) {
  const [todos, setTodos] = useState<TodoItem[]>(loadTodos);
  const [newText, setNewText] = useState("");

  useEffect(() => {
    saveTodos(todos);
  }, [todos]);

  const addTodo = useCallback(() => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    setTodos(prev => [
      {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        text: trimmed,
        completed: false,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setNewText("");
  }, [newText]);

  const toggleTodo = useCallback((id: string) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  }, []);

  const removeTodo = useCallback((id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setTodos(prev => prev.filter(t => !t.completed));
  }, []);

  const pending = todos.filter(t => !t.completed);
  const completed = todos.filter(t => t.completed);

  return (
    <div className="flex flex-col h-full bg-background" data-testid="todo-list-view">
      <div className="flex items-center gap-3 p-4 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-from-todo">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold">Att göra</h1>
          <p className="text-sm text-muted-foreground">
            {pending.length === 0
              ? "Inga uppgifter kvar"
              : `${pending.length} kvar`}
          </p>
        </div>
        {completed.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearCompleted}
            className="text-xs gap-1"
            data-testid="button-clear-completed"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Rensa klara
          </Button>
        )}
      </div>

      <div className="p-4 border-b bg-card">
        <form
          className="flex gap-2"
          onSubmit={e => { e.preventDefault(); addTodo(); }}
        >
          <Input
            value={newText}
            onChange={e => setNewText(e.target.value)}
            placeholder="Ny uppgift..."
            className="flex-1"
            data-testid="input-new-todo"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!newText.trim()}
            data-testid="button-add-todo"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </form>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-2">
        {pending.length === 0 && completed.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <ListTodo className="h-16 w-16 text-muted-foreground/40" />
            <div>
              <p className="text-lg font-semibold">Tomt här!</p>
              <p className="text-muted-foreground text-sm">Lägg till din första uppgift ovan</p>
            </div>
          </div>
        )}

        {pending.map(todo => (
          <Card key={todo.id} className="hover-elevate" data-testid={`todo-item-${todo.id}`}>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleTodo(todo.id)}
                  className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                  data-testid={`button-toggle-todo-${todo.id}`}
                >
                  <Circle className="h-5 w-5" />
                </button>
                <span className="flex-1 text-sm">{todo.text}</span>
                <button
                  onClick={() => removeTodo(todo.id)}
                  className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                  data-testid={`button-remove-todo-${todo.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </CardContent>
          </Card>
        ))}

        {completed.length > 0 && (
          <>
            <div className="flex items-center gap-2 pt-4 pb-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Klara ({completed.length})
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
            {completed.map(todo => (
              <Card key={todo.id} className="opacity-60" data-testid={`todo-item-${todo.id}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleTodo(todo.id)}
                      className="shrink-0 text-green-500"
                      data-testid={`button-toggle-todo-${todo.id}`}
                    >
                      <CheckCircle className="h-5 w-5" />
                    </button>
                    <span className="flex-1 text-sm line-through text-muted-foreground">{todo.text}</span>
                    <button
                      onClick={() => removeTodo(todo.id)}
                      className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                      data-testid={`button-remove-todo-${todo.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { ObjectCard } from "../ObjectCard";
import { Skeleton } from "@/components/ui/skeleton";

export default function ObjectCardExample() {
  const { data: objectsResponse, isLoading } = useQuery<{
    data?: Array<{
      id: string;
      name: string;
      objectNumber: string;
      objectType?: string;
      customerName?: string;
      address?: string;
      status: string;
    }>;
  } | Array<{
    id: string;
    name: string;
    objectNumber: string;
    objectType?: string;
    customerName?: string;
    address?: string;
    status: string;
  }>>({
    queryKey: ["/api/objects", { limit: 6 }],
  });

  const objects = Array.isArray(objectsResponse)
    ? objectsResponse.slice(0, 6)
    : (objectsResponse?.data || []).slice(0, 6);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-lg border p-4 space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {objects.map((obj) => (
        <ObjectCard key={obj.id} {...obj} />
      ))}
      {objects.length === 0 && (
        <p className="text-sm text-muted-foreground col-span-full text-center py-8" data-testid="text-no-objects">
          Inga objekt hittades
        </p>
      )}
    </div>
  );
}

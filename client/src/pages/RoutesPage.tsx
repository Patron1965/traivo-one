import { RouteMap } from "@/components/RouteMap";

export default function RoutesPage() {
  return (
    <div className="h-full p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Ruttplanering</h1>
        <p className="text-sm text-muted-foreground">Optimera dagens rutter och minimera körtid</p>
      </div>
      <div className="h-[calc(100%-60px)]">
        <RouteMap />
      </div>
    </div>
  );
}

import { RouteMap } from "../RouteMap";

export default function RouteMapExample() {
  return (
    <div className="h-[600px]">
      <RouteMap 
        onOptimize={() => console.log("Route optimized")}
        onNavigate={(jobId) => console.log("Navigate to job:", jobId)}
      />
    </div>
  );
}

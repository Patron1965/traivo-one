import { SimpleFieldApp } from "@/components/SimpleFieldApp";
import { useAuth } from "@/hooks/use-auth";

export default function MobileFieldPage() {
  const { user } = useAuth();
  
  return (
    <div className="h-screen">
      <SimpleFieldApp resourceId={user?.resourceId || user?.id} />
    </div>
  );
}

import { SimpleFieldApp } from "@/components/SimpleFieldApp";
import { useAuth } from "@/hooks/use-auth";

export default function MobileFieldPage() {
  const { user } = useAuth();
  
  return (
    <div className="h-[calc(100vh-4rem)]">
      <SimpleFieldApp resourceId={user?.id} />
    </div>
  );
}

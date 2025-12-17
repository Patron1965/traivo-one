import { useState } from "react";
import { JobModal } from "../JobModal";
import { Button } from "@/components/ui/button";

export default function JobModalExample() {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <Button onClick={() => setOpen(true)}>Öppna modal</Button>
      <JobModal 
        open={open} 
        onClose={() => setOpen(false)}
        onSubmit={(data) => console.log("Submitted:", data)}
      />
    </div>
  );
}

import { ObjectCard } from "../ObjectCard";

// todo: remove mock functionality
const mockObjects = [
  {
    id: "1",
    name: "Brunn 1 - Skogsbacken",
    objectNumber: "OBJ-001",
    objectType: "well",
    customerName: "Villa Skogsbacken AB",
    address: "Skogsbacken 12, Stockholm",
    avgSetupTime: 12,
    lastServiceDate: "2024-11-15",
    status: "active" as const,
  },
  {
    id: "2",
    name: "Pump Station - Skogsbacken",
    objectNumber: "OBJ-002",
    objectType: "station",
    customerName: "Villa Skogsbacken AB",
    address: "Skogsbacken 12, Stockholm",
    avgSetupTime: 18,
    lastServiceDate: "2024-10-20",
    status: "active" as const,
  },
  {
    id: "3",
    name: "Huvudbrunn - Norrtull",
    objectNumber: "OBJ-003",
    objectType: "well",
    customerName: "Fastighets AB Norrtull",
    address: "Norrtullsgatan 5, Stockholm",
    avgSetupTime: 22,
    lastServiceDate: "2024-09-05",
    status: "active" as const,
  },
];

export default function ObjectCardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {mockObjects.map((obj) => (
        <ObjectCard key={obj.id} {...obj} />
      ))}
    </div>
  );
}

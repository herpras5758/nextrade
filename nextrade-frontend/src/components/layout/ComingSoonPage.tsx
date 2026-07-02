import { Clock } from "lucide-react";
export function ComingSoonPage() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-[#97A0AF]">
      <Clock size={32} className="mb-3" />
      <p className="font-medium text-[#6B778C]">Segera Hadir</p>
      <p className="text-sm mt-1">Fitur ini sedang dalam pengembangan</p>
    </div>
  );
}

import {
  Briefcase,
  Code,
  Cpu,
  FlaskConical,
  Folder,
  Gamepad2,
  GraduationCap,
  Leaf,
  Map,
  Newspaper,
  ShoppingBag,
  Sparkles,
  Tag,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  "graduation-cap": GraduationCap,
  sparkles: Sparkles,
  code: Code,
  cpu: Cpu,
  map: Map,
  leaf: Leaf,
  "flask-conical": FlaskConical,
  newspaper: Newspaper,
  "gamepad-2": Gamepad2,
  "shopping-bag": ShoppingBag,
  folder: Folder,
  tag: Tag,
};

export function CategoryIcon({ name, size = 14, color }: { name?: string | null; size?: number; color?: string }) {
  const Icon = (name && ICONS[name]) || Tag;
  return <Icon size={size} color={color} aria-hidden />;
}

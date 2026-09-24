import { GraduationCap } from "lucide-react";
function Logo({ variant = "dark" }) {
  const isLight = variant === "light";
  return <div className="flex flex-col items-center text-center">
      <div
    className={`grid h-16 w-16 place-items-center rounded-full border-2 ${isLight ? "border-gold text-gold" : "border-navy text-navy"}`}
  >
        <GraduationCap className="h-8 w-8" />
      </div>
      <h1
    className={`mt-3 font-serif text-3xl leading-tight ${isLight ? "text-white" : "text-navy"}`}
    style={{ fontFamily: "var(--font-serif)" }}
  >
        Bharati
        <br />
        Vidyapeeth
      </h1>
      <p className={`mt-1 text-[10px] tracking-wide ${isLight ? "text-white/70" : "text-muted-foreground"}`}>
        (Deemed to be University)
      </p>
    </div>;
}
export {
  Logo
};

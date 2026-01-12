import { useEffect, useState } from "react";
import { Snowflake } from "lucide-react";

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setFadeOut(true);
    }, 1800);

    const completeTimer = setTimeout(() => {
      onComplete();
    }, 2300);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-white transition-opacity duration-500 ${fadeOut ? "opacity-0" : "opacity-100"}`}
      data-testid="splash-screen"
    >
      <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-500">
        <div className="text-blue-500 animate-spin" style={{ animationDuration: "3s" }}>
          <Snowflake className="h-20 w-20" />
        </div>
        
        <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
          <h1 className="text-5xl font-bold tracking-tight">
            <span className="text-green-600">Krashu</span>
            <span className="text-orange-500">Ved</span>
          </h1>
          <p className="mt-2 text-gray-500 text-lg animate-in fade-in duration-500 delay-700">
            Cold Store Manager
          </p>
        </div>
      </div>
    </div>
  );
}

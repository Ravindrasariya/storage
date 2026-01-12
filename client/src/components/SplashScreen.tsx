import { useEffect, useState } from "react";
import logoImage from "@assets/Gemini_Generated_Image_lu75dlu75dlu75dl(1)_1768195085916.png";

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [fadeOut, setFadeOut] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.src = logoImage;
    img.onload = () => setImageLoaded(true);
    img.onerror = () => setImageLoaded(true);
  }, []);

  useEffect(() => {
    if (!imageLoaded) return;

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
  }, [onComplete, imageLoaded]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-white transition-opacity duration-500 ${fadeOut ? "opacity-0" : "opacity-100"}`}
      data-testid="splash-screen"
    >
      <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-500">
        <img 
          src={logoImage} 
          alt="KrashuVed Logo" 
          className="h-24 w-auto"
        />
        
        <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
          <h1 className="text-5xl font-bold tracking-tight">
            <span className="text-green-600">Krashu</span>
            <span className="text-orange-500">Ved</span>
          </h1>
          <p className="mt-2 text-gray-500 text-lg animate-in fade-in duration-500 delay-700">
            Your Trust, Our Priority
          </p>
        </div>
      </div>
    </div>
  );
}

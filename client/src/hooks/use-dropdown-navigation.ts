import { useState } from "react";

export function useDropdownNavigation() {
  const [activeIndex, setActiveIndex] = useState(-1);

  const resetActive = () => setActiveIndex(-1);

  const handleKeyDown = (
    e: React.KeyboardEvent,
    itemCount: number,
    onSelect: (index: number) => void,
    onClose: () => void
  ) => {
    if (itemCount === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % itemCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? itemCount - 1 : prev - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < itemCount) {
        e.preventDefault();
        onSelect(activeIndex);
        setActiveIndex(-1);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActiveIndex(-1);
      onClose();
    }
  };

  return { activeIndex, handleKeyDown, resetActive };
}

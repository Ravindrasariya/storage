export interface DiscountFarmer {
  id: string;
  farmerName: string;
  village: string;
  contactNumber: string;
  totalDue: number;
}

export function sortedDiscountFarmers<T extends DiscountFarmer>(farmers: readonly T[], locale: string): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  return farmers.filter(farmer => farmer.totalDue >= 1).sort((a, b) =>
    collator.compare(a.farmerName.trim(), b.farmerName.trim())
    || collator.compare(a.village, b.village)
    || collator.compare(a.contactNumber, b.contactNumber)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function filterDiscountFarmers<T extends DiscountFarmer>(farmers: readonly T[], search: string, locale: string): readonly T[] {
  const normalize = (value: string) => value.normalize("NFC").toLocaleLowerCase(locale);
  const query = normalize(search.trim());
  return query ? farmers.filter(farmer =>
    [farmer.farmerName, farmer.village, farmer.contactNumber].some(value => normalize(value).includes(query)))
    : farmers;
}

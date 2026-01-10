import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Language = "en" | "hi";

interface Translations {
  [key: string]: {
    en: string;
    hi: string;
  };
}

const translations: Translations = {
  // App Header
  appTitle: { en: "Cold Storage Manager", hi: "शीत भंडार प्रबंधक" },
  dashboard: { en: "Dashboard", hi: "डैशबोर्ड" },
  newLot: { en: "New Lot Entry", hi: "नया लॉट प्रविष्टि" },
  searchEdit: { en: "Search / Edit", hi: "खोजें / संपादित करें" },
  analytics: { en: "Analytics", hi: "विश्लेषण" },
  help: { en: "Help", hi: "मदद" },
  
  // Dashboard
  storageCapacity: { en: "Storage Capacity", hi: "भंडारण क्षमता" },
  overallCapacity: { en: "Overall Capacity", hi: "कुल क्षमता" },
  capacityUsed: { en: "Capacity Used", hi: "प्रयुक्त क्षमता" },
  bags: { en: "bags", hi: "बैग" },
  chamberFillRates: { en: "Chamber Fill Rates", hi: "कक्ष भरण दर" },
  perBagRates: { en: "Per Bag Rates", hi: "प्रति बैग दरें" },
  wafer: { en: "Wafer", hi: "वेफर" },
  seed: { en: "Seed", hi: "बीज" },
  distinctFarmers: { en: "Distinct Farmers", hi: "अलग किसान" },
  totalLots: { en: "Total Lots", hi: "कुल लॉट" },
  totalBags: { en: "Total Bags", hi: "कुल बैग" },
  addNewLot: { en: "Add New Lot", hi: "नया लॉट जोड़ें" },
  
  // Lot Entry Form
  farmerDetails: { en: "Farmer Details", hi: "किसान विवरण" },
  farmerName: { en: "Farmer Name", hi: "किसान का नाम" },
  village: { en: "Village", hi: "गाँव" },
  tehsil: { en: "Tehsil", hi: "तहसील" },
  district: { en: "District", hi: "जिला" },
  state: { en: "State", hi: "राज्य" },
  contactNumber: { en: "Contact Number", hi: "संपर्क नंबर" },
  lotInformation: { en: "Lot Information", hi: "लॉट जानकारी" },
  lotNo: { en: "Lot No", hi: "लॉट नंबर" },
  size: { en: "Size (Bags)", hi: "आकार (बैग)" },
  storageLocation: { en: "Storage Location", hi: "भंडारण स्थान" },
  chamber: { en: "Chamber", hi: "कक्ष" },
  floor: { en: "Floor", hi: "मंजिल" },
  position: { en: "Position", hi: "स्थिति" },
  qualityAssessment: { en: "Quality Assessment", hi: "गुणवत्ता मूल्यांकन" },
  type: { en: "Type", hi: "प्रकार" },
  bagType: { en: "Bag Type", hi: "बैग प्रकार" },
  quality: { en: "Quality", hi: "गुणवत्ता" },
  assayingType: { en: "Assaying Type", hi: "परख प्रकार" },
  qualityCheck: { en: "Quality Check", hi: "गुणवत्ता जांच" },
  visual: { en: "Visual", hi: "दृश्य" },
  assayerImage: { en: "Assayer Image", hi: "परीक्षक छवि" },
  reducingSugar: { en: "Reducing Sugar", hi: "रिड्यूसिंग शुगर" },
  dm: { en: "DM (Dry Matter)", hi: "डीएम (सूखा पदार्थ)" },
  remarks: { en: "Remarks", hi: "टिप्पणियाँ" },
  submit: { en: "Submit", hi: "जमा करें" },
  cancel: { en: "Cancel", hi: "रद्द करें" },
  back: { en: "Back to Dashboard", hi: "डैशबोर्ड पर वापस" },
  
  // Quality levels
  poor: { en: "Poor", hi: "खराब" },
  medium: { en: "Medium", hi: "मध्यम" },
  good: { en: "Good", hi: "अच्छा" },
  
  // Search/Edit
  searchBy: { en: "Search By", hi: "द्वारा खोजें" },
  phoneNumber: { en: "Phone Number", hi: "फोन नंबर" },
  lotNumber: { en: "Lot Number", hi: "लॉट नंबर" },
  search: { en: "Search", hi: "खोजें" },
  edit: { en: "Edit", hi: "संपादित करें" },
  save: { en: "Save", hi: "सहेजें" },
  partialSale: { en: "Partial Sale", hi: "आंशिक बिक्री" },
  quantitySold: { en: "Quantity Sold", hi: "बेची गई मात्रा" },
  pricePerBag: { en: "Price per Bag", hi: "प्रति बैग मूल्य" },
  totalPrice: { en: "Total Price", hi: "कुल मूल्य" },
  remaining: { en: "Remaining", hi: "शेष" },
  originalSize: { en: "Original Size", hi: "मूल आकार" },
  editHistory: { en: "Edit History", hi: "संपादन इतिहास" },
  noResults: { en: "No results found", hi: "कोई परिणाम नहीं मिला" },
  
  // Analytics
  chamberQualityAnalysis: { en: "Chamber Quality Analysis", hi: "कक्ष गुणवत्ता विश्लेषण" },
  qualityDistribution: { en: "Quality Distribution", hi: "गुणवत्ता वितरण" },
  bagsByQuality: { en: "Bags by Quality", hi: "गुणवत्ता के अनुसार बैग" },
  
  // Footer
  createdBy: { en: "Created & Maintained by KrashuVed", hi: "KrashuVed द्वारा निर्मित और अनुरक्षित" },
  allRightsReserved: { en: "All Rights Reserved", hi: "सर्वाधिकार सुरक्षित" },
  needHelp: { en: "Need Help? Reach out to KrashuVed", hi: "मदद चाहिए? KrashuVed से संपर्क करें" },
  
  // Common
  loading: { en: "Loading...", hi: "लोड हो रहा है..." },
  error: { en: "Error", hi: "त्रुटि" },
  success: { en: "Success", hi: "सफलता" },
  required: { en: "Required", hi: "आवश्यक" },
  confirm: { en: "Confirm", hi: "पुष्टि करें" },
  quantity: { en: "Quantity", hi: "मात्रा" },
  filters: { en: "Filters", hi: "फ़िल्टर" },
  all: { en: "All", hi: "सभी" },
  coldChargesDue: { en: "Cold Charges Due", hi: "कोल्ड स्टोरेज शुल्क बाकी" },
  coldChargesPaid: { en: "Cold Charges Paid", hi: "कोल्ड स्टोरेज शुल्क भुगतान" },
  markAsPaid: { en: "Mark as Paid", hi: "भुगतान किया चिह्नित करें" },
  markAsDue: { en: "Mark as Due", hi: "बकाया चिह्नित करें" },
  markedAsDue: { en: "Marked as due", hi: "बकाया के रूप में चिह्नित" },
  coldStorageName: { en: "Cold Storage Name", hi: "कोल्ड स्टोरेज का नाम" },
  name: { en: "Name", hi: "नाम" },
  
  // Settings
  freeCapacity: { en: "Free", hi: "खाली" },
  settings: { en: "Settings", hi: "सेटिंग्स" },
  addChamber: { en: "Add Chamber", hi: "कक्ष जोड़ें" },
  addFloor: { en: "Add Floor", hi: "मंजिल जोड़ें" },
  noFloorsConfigured: { en: "No floors configured. Click 'Add Floor' to set floor capacities.", hi: "कोई मंजिल कॉन्फ़िगर नहीं। मंजिल क्षमता सेट करने के लिए 'मंजिल जोड़ें' पर क्लिक करें।" },
  capacity: { en: "Capacity", hi: "क्षमता" },
  rate: { en: "Rate", hi: "दर" },
  chambers: { en: "Chambers", hi: "कक्ष" },
  coldStorageCharge: { en: "Cold Storage Charge", hi: "कोल्ड स्टोरेज शुल्क" },
  hammali: { en: "Hammali", hi: "हमाली" },
  total: { en: "Total", hi: "कुल" },
  
  // Up for Sale
  upForSale: { en: "Up for Sale", hi: "बिक्री के लिए" },
  markForSale: { en: "Mark for Sale", hi: "बिक्री के लिए चिह्नित करें" },
  removeFromSale: { en: "Remove from Sale", hi: "बिक्री से हटाएं" },
  removedFromSale: { en: "Removed from sale list", hi: "बिक्री सूची से हटाया गया" },
  
  // Sale/Payment
  sold: { en: "Sold", hi: "बेचा गया" },
  markAsSold: { en: "Mark as Sold", hi: "बेचा गया चिह्नित करें" },
  confirmSale: { en: "Confirm Sale", hi: "बिक्री की पुष्टि करें" },
  storageCharge: { en: "Storage Charge", hi: "भंडारण शुल्क" },
  paymentStatus: { en: "Payment Status", hi: "भुगतान स्थिति" },
  paid: { en: "Paid", hi: "भुगतान किया" },
  due: { en: "Due", hi: "बाकी" },
  partialPayment: { en: "Partial Payment", hi: "आंशिक भुगतान" },
  amountPaid: { en: "Amount Paid", hi: "भुगतान राशि" },
  overallPayment: { en: "Overall Payment", hi: "कुल भुगतान" },
  totalPaid: { en: "Total Paid", hi: "कुल भुगतान" },
  totalDue: { en: "Total Due", hi: "कुल बाकी" },
  paymentSummary: { en: "Payment Summary", hi: "भुगतान सारांश" },
  available: { en: "Available", hi: "उपलब्ध" },
  buyerName: { en: "Buyer Name", hi: "खरीदार का नाम" },
  pricePerKg: { en: "Price/kg (Selling Price)", hi: "मूल्य/किग्रा (बिक्री मूल्य)" },
  optional: { en: "Optional", hi: "वैकल्पिक" },
  
  // Sales History
  salesHistory: { en: "History of Sales", hi: "बिक्री का इतिहास" },
  entryDate: { en: "Entry Date", hi: "प्रवेश तिथि" },
  saleDate: { en: "Sale Date", hi: "बिक्री तिथि" },
  saleType: { en: "Sale Type", hi: "बिक्री प्रकार" },
  fullSale: { en: "Full Sale", hi: "पूर्ण बिक्री" },
  year: { en: "Year", hi: "वर्ष" },
  allYears: { en: "All Years", hi: "सभी वर्ष" },
  filterByYear: { en: "Filter by Year", hi: "वर्ष के अनुसार फ़िल्टर करें" },
  filterByFarmer: { en: "Filter by Farmer", hi: "किसान के अनुसार फ़िल्टर करें" },
  filterByMobile: { en: "Filter by Mobile", hi: "मोबाइल के अनुसार फ़िल्टर करें" },
  filterByPayment: { en: "Filter by Payment", hi: "भुगतान के अनुसार फ़िल्टर करें" },
  noSalesHistory: { en: "No sales history found", hi: "कोई बिक्री इतिहास नहीं मिला" },
  potatoType: { en: "Potato Type", hi: "आलू का प्रकार" },
  clearFilters: { en: "Clear Filters", hi: "फ़िल्टर साफ़ करें" },
  paidOn: { en: "Paid on", hi: "भुगतान तिथि" },
  
  // Maintenance
  maintenance: { en: "Maintenance", hi: "रखरखाव" },
  taskDescription: { en: "Task Description", hi: "कार्य विवरण" },
  responsiblePerson: { en: "Responsible Person", hi: "जिम्मेदार व्यक्ति" },
  nextDueDate: { en: "Next Due Date", hi: "अगली देय तिथि" },
  addRow: { en: "Add Row", hi: "पंक्ति जोड़ें" },
  saveMaintenance: { en: "Save Maintenance", hi: "रखरखाव सहेजें" },

  // Reset Season
  resetForNextSeason: { en: "Reset for Next Season", hi: "अगले सीज़न के लिए रीसेट करें" },
  resetWarning: { en: "This option should only be selected when a new season is starting. All data on dashboard and search/edit page will be reset to zero.", hi: "यह विकल्प केवल तभी चुना जाना चाहिए जब नया सीज़न शुरू हो रहा हो। डैशबोर्ड और खोज/संपादन पृष्ठ पर सभी डेटा शून्य पर रीसेट हो जाएगा।" },
  resetCannotProceed: { en: "Cannot reset: There are still lots with remaining bags. All lots must be sold or emptied before resetting.", hi: "रीसेट नहीं हो सकता: अभी भी बाकी बैग वाले लॉट हैं। रीसेट करने से पहले सभी लॉट बेचे या खाली किए जाने चाहिए।" },
  resetSuccess: { en: "Season reset successful! Dashboard and lots have been cleared.", hi: "सीज़न रीसेट सफल! डैशबोर्ड और लॉट साफ़ कर दिए गए हैं।" },
  proceedWithReset: { en: "Proceed with Reset", hi: "रीसेट के साथ आगे बढ़ें" },
  remainingBags: { en: "Remaining Bags", hi: "बाकी बैग" },
  remainingLots: { en: "Remaining Lots", hi: "बाकी लॉट" },
};

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("language") as Language) || "en";
    }
    return "en";
  });

  useEffect(() => {
    localStorage.setItem("language", language);
  }, [language]);

  const t = (key: string): string => {
    const translation = translations[key];
    if (!translation) {
      console.warn(`Missing translation for key: ${key}`);
      return key;
    }
    return translation[language];
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}

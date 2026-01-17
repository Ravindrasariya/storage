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
  appTitle: { en: "Cold Store Manager", hi: "शीत भंडार प्रबंधक" },
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
  perBagRate: { en: "Per Bag Rate", hi: "प्रति बैग दर" },
  bag: { en: "bag", hi: "बैग" },
  wafer: { en: "Wafer", hi: "वेफर" },
  seed: { en: "Seed", hi: "बीज" },
  farmers: { en: "Farmers", hi: "किसान" },
  distinctFarmers: { en: "Distinct Farmers", hi: "अलग किसान" },
  ration: { en: "Ration", hi: "राशन" },
  totalLots: { en: "Total Lots", hi: "कुल लॉट" },
  totalBags: { en: "Total Bags", hi: "कुल बैग" },
  totalRemainingBags: { en: "Remaining Bags", hi: "शेष बैग" },
  totalChargesPaid: { en: "Charges Paid", hi: "भुगतान किया शुल्क" },
  totalChargesDue: { en: "Charges Due", hi: "बकाया शुल्क" },
  searchSummary: { en: "Search Summary", hi: "खोज सारांश" },
  addNewLot: { en: "Add New Lot", hi: "नया लॉट जोड़ें" },
  
  // Lot Entry Form
  farmerDetails: { en: "Farmer Details", hi: "किसान विवरण" },
  farmerName: { en: "Farmer Name", hi: "किसान का नाम" },
  enterFarmerName: { en: "Enter farmer name...", hi: "किसान का नाम दर्ज करें..." },
  village: { en: "Village", hi: "गाँव" },
  tehsil: { en: "Tehsil", hi: "तहसील" },
  district: { en: "District", hi: "जिला" },
  state: { en: "State", hi: "राज्य" },
  contactNumber: { en: "Contact Number", hi: "संपर्क नंबर" },
  lotInformation: { en: "Lot Information", hi: "लॉट जानकारी" },
  lot: { en: "Lot", hi: "लॉट" },
  addMoreLot: { en: "Add More Lot", hi: "और लॉट जोड़ें" },
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
  potatoSize: { en: "Potato Size", hi: "आलू का आकार" },
  selectSize: { en: "Select size", hi: "आकार चुनें" },
  large: { en: "Large", hi: "बड़ा" },
  small: { en: "Small", hi: "छोटा" },
  
  // Search/Edit
  searchBy: { en: "Search By", hi: "द्वारा खोजें" },
  phoneNumber: { en: "Phone Number", hi: "फोन नंबर" },
  lotNumber: { en: "Lot Number", hi: "लॉट नंबर" },
  search: { en: "Search", hi: "खोजें" },
  edit: { en: "Edit", hi: "संपादित करें" },
  print: { en: "Print", hi: "प्रिंट" },
  printBill: { en: "Print Bill", hi: "बिल प्रिंट करें" },
  saveAndPrint: { en: "Save & Print", hi: "सेव करें और प्रिंट करें" },
  lotEntryReceipt: { en: "Lot Entry Receipt", hi: "लॉट प्रविष्टि रसीद" },
  lotDetails: { en: "Lot Details", hi: "लॉट विवरण" },
  receiptFooterNote: { en: "This is a computer generated receipt.", hi: "यह कंप्यूटर द्वारा जनित रसीद है।" },
  close: { en: "Close", hi: "बंद करें" },
  selectBillType: { en: "Select the type of bill to print", hi: "प्रिंट करने के लिए बिल का प्रकार चुनें" },
  coldStorageDeductionBill: { en: "Cold Storage Deduction Bill", hi: "कोल्ड स्टोरेज कटौती बिल" },
  chargesBreakdown: { en: "Shows all charges breakdown", hi: "सभी शुल्कों का विवरण दिखाता है" },
  salesBill: { en: "Sales Bill", hi: "बिक्री बिल" },
  incomeAndDeductions: { en: "Shows income and deductions", hi: "आय और कटौती दिखाता है" },
  save: { en: "Save", hi: "सहेजें" },
  partialSale: { en: "Partial Sale", hi: "आंशिक बिक्री" },
  quantitySold: { en: "Quantity Sold", hi: "बेची गई मात्रा" },
  originalBags: { en: "Original # Bags", hi: "मूल # बैग" },
  pricePerBag: { en: "Price per Bag", hi: "प्रति बैग मूल्य" },
  totalPrice: { en: "Total Price", hi: "कुल मूल्य" },
  remaining: { en: "Remaining", hi: "शेष" },
  originalSize: { en: "Original Size", hi: "मूल आकार" },
  editHistory: { en: "Edit History", hi: "संपादन इतिहास" },
  editableFields: { en: "Editable Fields (Location & Quality)", hi: "संपादन योग्य फ़ील्ड (स्थान और गुणवत्ता)" },
  reverse: { en: "Reverse", hi: "वापस करें" },
  editReversed: { en: "Edit reversed successfully", hi: "संपादन सफलतापूर्वक वापस किया गया" },
  coldStorageCharges: { en: "Cold Storage Charges", hi: "कोल्ड स्टोरेज शुल्क" },
  selectChamber: { en: "Select Chamber", hi: "कक्ष चुनें" },
  selectFloor: { en: "Select Floor", hi: "मंजिल चुनें" },
  selectChamberFirst: { en: "Select chamber first", hi: "पहले कक्ष चुनें" },
  changes: { en: "Changes", hi: "परिवर्तन" },
  chamberQualityAnalysis: { en: "Chamber Quality Analysis", hi: "कक्ष गुणवत्ता विश्लेषण" },
  qualityDistribution: { en: "Quality Distribution", hi: "गुणवत्ता वितरण" },
  qualityDistributionRemaining: { en: "Quality Distribution Of Remaining Bags", hi: "शेष बैगों का गुणवत्ता वितरण" },
  bagsByQuality: { en: "Bags by Quality", hi: "गुणवत्ता के अनुसार बैग" },
  initialDistribution: { en: "Initial distribution when storage was filled", hi: "भंडार भरने के समय प्रारंभिक वितरण" },
  
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
  or: { en: "or", hi: "या" },
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
  totalColdStorageCharges: { en: "Total Cold Storage Charges", hi: "कुल कोल्ड स्टोरेज शुल्क" },
  hammali: { en: "Hammali", hi: "हमाली" },
  salary: { en: "Salary", hi: "वेतन" },
  gradingCharges: { en: "Grading Charge", hi: "ग्रेडिंग शुल्क" },
  generalExpenses: { en: "General Expense", hi: "सामान्य खर्च" },
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
  paymentMode: { en: "Payment Mode", hi: "भुगतान का तरीका" },
  cash: { en: "Cash", hi: "नकद" },
  account: { en: "Account Transfer", hi: "खाता ट्रांसफर" },
  amountPaid: { en: "Amount Paid", hi: "भुगतान राशि" },
  amountDue: { en: "Amount Due", hi: "बकाया राशि" },
  totalBagsSold: { en: "Total Bags Sold", hi: "कुल बेचे गए बैग" },
  overallPayment: { en: "Overall Payment", hi: "कुल भुगतान" },
  totalPaid: { en: "Total Paid", hi: "कुल भुगतान" },
  totalDue: { en: "Total Due", hi: "कुल बाकी" },
  totalHammali: { en: "Total Hammali", hi: "कुल हम्माली" },
  totalGradingCharges: { en: "Total Grading", hi: "कुल ग्रेडिंग" },
  soldLots: { en: "sold lots", hi: "बेचे गए लॉट" },
  lots: { en: "lots", hi: "लॉट" },
  paymentSummary: { en: "Payment Summary", hi: "भुगतान सारांश" },
  available: { en: "Available", hi: "उपलब्ध" },
  buyerName: { en: "Buyer Name", hi: "खरीदार का नाम" },
  pricePerKg: { en: "Price/kg (Selling Price)", hi: "मूल्य/किग्रा (बिक्री मूल्य)" },
  netWeight: { en: "Net Weight", hi: "शुद्ध वजन" },
  netWeightKg: { en: "Net weight in kg", hi: "किग्रा में शुद्ध वजन" },
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
  filterByBuyer: { en: "Filter by Buyer", hi: "खरीदार के अनुसार फ़िल्टर करें" },
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

  // Additional Charges
  kataCharges: { en: "Kata (Weighing) Charges", hi: "काटा (तौल) शुल्क" },
  deliveryType: { en: "Delivery Type", hi: "डिलीवरी प्रकार" },
  biltyCut: { en: "Bilty Cut", hi: "बिल्टी कट" },
  gateCut: { en: "Gate Cut", hi: "गेट कट" },
  extraHammaliPerBag: { en: "Extra Hammali/bag", hi: "अतिरिक्त हमाली/बैग" },
  rateBreakdown: { en: "Rate Breakdown", hi: "दर विवरण" },
  perBag: { en: "/bag", hi: "/बैग" },

  // Merchant Analysis
  merchantAnalysis: { en: "Merchant Analysis", hi: "व्यापारी विश्लेषण" },
  selectBuyer: { en: "Select Buyer", hi: "खरीदार चुनें" },
  other: { en: "Other", hi: "अन्य" },
  allBuyers: { en: "All Buyers", hi: "सभी खरीदार" },
  bagsPurchased: { en: "Bags Purchased", hi: "खरीदे गए बैग" },
  totalValueINR: { en: "Total Value (INR)", hi: "कुल मूल्य (INR)" },
  totalChargesPaidMerchant: { en: "Total Charges Paid", hi: "कुल शुल्क भुगतान" },
  totalChargesDueMerchant: { en: "Total Charges Due", hi: "कुल शुल्क बाकी" },
  noMerchantData: { en: "No buyer data available for selected year", hi: "चयनित वर्ष के लिए कोई खरीदार डेटा उपलब्ध नहीं" },
  
  // Reset Season
  resetForNextSeason: { en: "Reset for Next Season", hi: "अगले सीज़न के लिए रीसेट करें" },
  resetWarning: { en: "This option should only be selected when a new season is starting. All data on dashboard and search/edit page will be reset to zero.", hi: "यह विकल्प केवल तभी चुना जाना चाहिए जब नया सीज़न शुरू हो रहा हो। डैशबोर्ड और खोज/संपादन पृष्ठ पर सभी डेटा शून्य पर रीसेट हो जाएगा।" },
  resetCannotProceed: { en: "Cannot reset: There are still lots with remaining bags. All lots must be sold or emptied before resetting.", hi: "रीसेट नहीं हो सकता: अभी भी बाकी बैग वाले लॉट हैं। रीसेट करने से पहले सभी लॉट बेचे या खाली किए जाने चाहिए।" },
  resetSuccess: { en: "Season reset successful! Dashboard and lots have been cleared.", hi: "सीज़न रीसेट सफल! डैशबोर्ड और लॉट साफ़ कर दिए गए हैं।" },
  proceedWithReset: { en: "Proceed with Reset", hi: "रीसेट के साथ आगे बढ़ें" },
  remainingBags: { en: "Remaining Bags", hi: "बाकी बैग" },
  remainingLots: { en: "Remaining Lots", hi: "बाकी लॉट" },

  // Edit Sale Dialog
  editSale: { en: "Edit Sale", hi: "बिक्री संपादित करें" },
  saleDetails: { en: "Sale Details", hi: "बिक्री विवरण" },
  enterBuyerName: { en: "Enter buyer name", hi: "खरीदार का नाम दर्ज करें" },
  sellingPrice: { en: "Selling Price", hi: "बिक्री मूल्य" },
  currentStatus: { en: "Current Status", hi: "वर्तमान स्थिति" },
  keepAsPaid: { en: "Keep as Paid", hi: "भुगतान के रूप में रखें" },
  keepAsDue: { en: "Keep as Due", hi: "बकाया के रूप में रखें" },
  keepAsPartial: { en: "Keep as Partial", hi: "आंशिक के रूप में रखें" },
  markAsPartial: { en: "Mark as Partial Payment", hi: "आंशिक भुगतान के रूप में चिह्नित करें" },
  paidAmount: { en: "Paid Amount", hi: "भुगतान राशि" },
  maxAmount: { en: "Max Amount", hi: "अधिकतम राशि" },
  partial: { en: "Partial", hi: "आंशिक" },
  saleUpdated: { en: "Sale updated successfully", hi: "बिक्री सफलतापूर्वक अपडेट की गई" },
  failedToUpdateSale: { en: "Failed to update sale", hi: "बिक्री अपडेट करने में विफल" },
  noChanges: { en: "No changes to save", hi: "सहेजने के लिए कोई परिवर्तन नहीं" },
  saving: { en: "Saving...", hi: "सहेज रहा है..." },
  reverseSale: { en: "Reverse Sale", hi: "बिक्री वापस करें" },
  reverseSaleConfirmTitle: { en: "Reverse this Sale?", hi: "क्या आप इस बिक्री को वापस करना चाहते हैं?" },
  reverseSaleConfirmMessage: { en: "Are you sure you want to remove this sale history and move the lot back to unsold inventory? This action cannot be undone.", hi: "क्या आप वाकई इस बिक्री इतिहास को हटाना और लॉट को वापस बिना बिके इन्वेंट्री में ले जाना चाहते हैं? यह क्रिया पूर्ववत नहीं की जा सकती।" },
  yesReverse: { en: "Yes, Reverse Sale", hi: "हाँ, बिक्री वापस करें" },
  reversing: { en: "Reversing...", hi: "वापस कर रहा है..." },
  saleReversed: { en: "Sale reversed successfully. Lot moved back to inventory.", hi: "बिक्री सफलतापूर्वक वापस कर दी गई। लॉट वापस इन्वेंट्री में चला गया।" },
  failedToReverseSale: { en: "Failed to reverse sale", hi: "बिक्री वापस करने में विफल" },

  // Exit (Nikasi)
  exit: { en: "Exit", hi: "निकासी" },
  exitReceipt: { en: "Exit Receipt", hi: "निकासी रसीद" },
  bagsToExit: { en: "Bags to Exit", hi: "निकासी के लिए बैग" },
  maxBagsToExit: { en: "Max bags available for exit", hi: "निकासी के लिए उपलब्ध अधिकतम बैग" },
  totalExited: { en: "Total Exited", hi: "कुल निकासी" },
  remainingToExit: { en: "Remaining to Exit", hi: "निकासी के लिए शेष" },
  exitHistory: { en: "Exit History", hi: "निकासी इतिहास" },
  noExitHistory: { en: "No exit history", hi: "कोई निकासी इतिहास नहीं" },
  exitDate: { en: "Exit Date", hi: "निकासी तिथि" },
  bagsExited: { en: "Bags Exited", hi: "निकासी किए गए बैग" },
  reverseExit: { en: "Reverse Latest Exit", hi: "नवीनतम निकासी वापस करें" },
  exitReversed: { en: "Exit reversed successfully", hi: "निकासी सफलतापूर्वक वापस कर दी गई" },
  failedToReverseExit: { en: "Failed to reverse exit", hi: "निकासी वापस करने में विफल" },
  exitCreated: { en: "Exit recorded successfully", hi: "निकासी सफलतापूर्वक दर्ज की गई" },
  failedToCreateExit: { en: "Failed to record exit", hi: "निकासी दर्ज करने में विफल" },
  coldStorageManagerSignature: { en: "Cold Store Manager Signature", hi: "शीत भंडार प्रबंधक हस्ताक्षर" },
  reversed: { en: "Reversed", hi: "वापस" },

  // Cash Management
  cashManagement: { en: "Cash Management", hi: "नकद प्रबंधन" },
  inwardCash: { en: "Inward Cash", hi: "आने वाला नकद" },
  receiptType: { en: "Receipt Type", hi: "रसीद प्रकार" },
  cashReceived: { en: "Cash Received", hi: "नकद प्राप्त" },
  accountReceived: { en: "Account Received", hi: "खाते में प्राप्त" },
  amount: { en: "Amount", hi: "राशि" },
  receivedOn: { en: "Received On", hi: "प्राप्ति तिथि" },
  recordPayment: { en: "Record Payment", hi: "भुगतान दर्ज करें" },
  recentReceipts: { en: "Recent Receipts", hi: "हाल की रसीदें" },
  noReceipts: { en: "No receipts recorded yet", hi: "अभी तक कोई रसीद दर्ज नहीं" },
  noBuyersWithDues: { en: "No buyers with pending dues", hi: "कोई बकाया वाले खरीदार नहीं" },
  paymentRecorded: { en: "Payment recorded successfully", hi: "भुगतान सफलतापूर्वक दर्ज किया गया" },
  salesAdjusted: { en: "sales adjusted", hi: "बिक्री समायोजित" },
  appliedAmount: { en: "Applied", hi: "लागू" },
  unappliedAmount: { en: "Unapplied", hi: "अलागू" },
  
  // Expense section
  expense: { en: "Expense", hi: "व्यय" },
  expenseType: { en: "Expense Type", hi: "व्यय प्रकार" },
  recordExpense: { en: "Record Expense", hi: "व्यय दर्ज करें" },
  expenseRecorded: { en: "Expense recorded successfully", hi: "व्यय सफलतापूर्वक दर्ज किया गया" },
  cashFlowHistory: { en: "Cash Flow History", hi: "नकद प्रवाह इतिहास" },
  noTransactions: { en: "No transactions recorded yet", hi: "अभी तक कोई लेनदेन दर्ज नहीं" },
  inflow: { en: "Inflow", hi: "आवक" },
  outflow: { en: "Outflow", hi: "जावक" },
  selectExpenseType: { en: "Select expense type", hi: "व्यय प्रकार चुनें" },
  
  // Cash Summary
  totalCashReceived: { en: "Total Cash Received", hi: "कुल नकद प्राप्त" },
  cashExpense: { en: "Cash Expense", hi: "नकद खर्च" },
  totalCashInHand: { en: "Cash in Hand", hi: "हाथ में नकद" },
  totalAccountReceived: { en: "Total Account Received", hi: "कुल खाते में प्राप्त" },
  totalExpenseFromAccount: { en: "Expense from Account", hi: "खाते से व्यय" },
  asOf: { en: "As of", hi: "तारीख" },
  cashExpenses: { en: "Cash Expenses", hi: "नकद खर्च" },
  
  // Filters (extended)
  filterByCategory: { en: "Filter by Category", hi: "श्रेणी द्वारा फ़िल्टर" },
  filterByMonth: { en: "Filter by Month", hi: "महीने द्वारा फ़िल्टर" },
  allCategories: { en: "All Categories", hi: "सभी श्रेणियाँ" },
  allMonths: { en: "All Months", hi: "सभी महीने" },
  filteredResults: { en: "Filtered Results", hi: "फ़िल्टर किए गए परिणाम" },
  byBuyer: { en: "By Buyer", hi: "खरीदार द्वारा" },
  byCategory: { en: "By Category", hi: "श्रेणी द्वारा" },
  partialPaid: { en: "Partial Paid", hi: "आंशिक भुगतान" },
  usePaymentManager: { en: "Use Cash Management to update payments", hi: "भुगतान अपडेट करने के लिए कैश मैनेजमेंट का उपयोग करें" },
  status: { en: "Status", hi: "स्थिति" },
  confirmReverse: { en: "Confirm Reversal", hi: "उलटने की पुष्टि करें" },
  reverseWarning: { en: "This will undo this transaction and all associated payment changes. This action cannot be undone.", hi: "यह इस लेनदेन और सभी संबंधित भुगतान परिवर्तनों को पूर्ववत कर देगा। यह क्रिया पूर्ववत नहीं की जा सकती।" },
  entryReversed: { en: "Entry reversed successfully", hi: "प्रविष्टि सफलतापूर्वक उलट दी गई" },
  reversalFailed: { en: "Failed to reverse entry", hi: "प्रविष्टि उलटने में विफल" },
  
  // Login/Authentication
  welcome: { en: "Welcome", hi: "स्वागत है" },
  mobileNumber: { en: "Mobile Number", hi: "मोबाइल नंबर" },
  password: { en: "Password", hi: "पासवर्ड" },
  login: { en: "Login", hi: "लॉग इन" },
  logout: { en: "Logout", hi: "लॉग आउट" },
  changePassword: { en: "Change Password", hi: "पासवर्ड बदलें" },
  currentPassword: { en: "Current Password", hi: "वर्तमान पासवर्ड" },
  newPassword: { en: "New Password", hi: "नया पासवर्ड" },
  confirmPassword: { en: "Confirm Password", hi: "पासवर्ड की पुष्टि करें" },
  loginSuccess: { en: "Login successful", hi: "लॉगिन सफल" },
  loginFailed: { en: "Login failed", hi: "लॉगिन विफल" },
  captchaRequired: { en: "Verification required", hi: "सत्यापन आवश्यक" },
  pleaseCompleteCaptcha: { en: "Please complete the CAPTCHA verification", hi: "कृपया CAPTCHA सत्यापन पूरा करें" },
  passwordChanged: { en: "Password changed", hi: "पासवर्ड बदला गया" },
  passwordChangedSuccess: { en: "Your password has been updated successfully", hi: "आपका पासवर्ड सफलतापूर्वक अपडेट किया गया" },
  enterCredentials: { en: "Enter credentials", hi: "क्रेडेंशियल दर्ज करें" },
  enterCredentialsFirst: { en: "Please enter your mobile number and current password first", hi: "कृपया पहले अपना मोबाइल नंबर और वर्तमान पासवर्ड दर्ज करें" },
  coldStorageDetails: { en: "Cold Storage Details", hi: "शीत भंडार विवरण" },
  editAccess: { en: "Edit Access", hi: "संपादन पहुंच" },
  viewOnly: { en: "View Only", hi: "केवल देखें" },
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

// What Mandi's agent says when a seller writes to it on WhatsApp, in each
// seller language. Like lib/i18n/seller.ts, the Indian-language strings should
// be reviewed by a native speaker before launch.
import type { SellerLanguage } from "./seller";

export interface WhatsAppReplies {
  help: string;
  languageMenu: string;
  languageSet: string;
  shipped: (title: string, tracking: string) => string;
  nothingToShip: string;
  cantRead: string;
  refundDone: (amt: string) => string;
  refundKept: string;
  nothingPending: string;
  status: (toShip: number, held: string, paid: string) => string;
  commissionAsk: (request: string, amt: string, days: number) => string;
  commissionSent: (amt: string) => string;
  commissionDeclined: string;
}

export const WHATSAPP_REPLIES: Record<SellerLanguage, WhatsAppReplies> = {
  en: {
    help: "Reply to me here:\n📷 A photo of the shipping receipt: I mark the order shipped and PayPal releases your money.\n✅ Yes / ❌ No: answer my question.\n📊 \"status\": your sales.\n🌐 \"language\": change language.",
    languageMenu: "Choose your language. Reply with the number:",
    languageSet: "Done. I'll write to you in English from now on.",
    shipped: (title, tracking) => `Marked as shipped: ${title}, tracking ${tracking}. PayPal has released the money.`,
    nothingToShip: "There's no order waiting to be shipped.",
    cantRead: "I couldn't read a tracking number. Please type it, for example EE123456789IN.",
    refundDone: (amt) => `Done. ${amt} has been refunded to the buyer.`,
    refundKept: "OK, no refund. The buyer has been told.",
    nothingPending: "Nothing is waiting for your answer right now.",
    status: (n, held, paid) => `To ship: ${n}\nHeld by PayPal: ${held}\nPaid to you: ${paid}`,
    commissionAsk: (req, amt, days) => `New custom order: "${req}"\nYour agent suggests ${amt}, ready in ${days} days.\nReply Yes to send the buyer a PayPal invoice, or No to decline.`,
    commissionSent: (amt) => `Invoice for ${amt} sent to the buyer through PayPal.`,
    commissionDeclined: "OK, declined. The buyer has been told.",
  },
  hi: {
    help: "मुझे यहीं जवाब दें:\n📷 शिपिंग रसीद की फ़ोटो: मैं ऑर्डर को भेजा हुआ मार्क करूँगा और PayPal आपका पैसा जारी करेगा।\n✅ हाँ / ❌ नहीं: मेरे सवाल का जवाब।\n📊 \"हिसाब\": आपकी बिक्री।\n🌐 \"भाषा\": भाषा बदलें।",
    languageMenu: "अपनी भाषा चुनें। नंबर लिखकर जवाब दें:",
    languageSet: "हो गया। अब से मैं आपको हिन्दी में लिखूँगा।",
    shipped: (title, tracking) => `भेजा हुआ मार्क किया: ${title}, ट्रैकिंग ${tracking}। PayPal ने पैसा जारी कर दिया है।`,
    nothingToShip: "अभी कोई ऑर्डर भेजने के लिए बाकी नहीं है।",
    cantRead: "मैं ट्रैकिंग नंबर नहीं पढ़ पाया। कृपया उसे लिखकर भेजें, जैसे EE123456789IN।",
    refundDone: (amt) => `हो गया। खरीदार को ${amt} वापस कर दिए गए।`,
    refundKept: "ठीक है, कोई रिफंड नहीं। खरीदार को बता दिया गया है।",
    nothingPending: "अभी आपके जवाब के लिए कुछ बाकी नहीं है।",
    status: (n, held, paid) => `भेजना है: ${n}\nPayPal में सुरक्षित: ${held}\nआपको मिला: ${paid}`,
    commissionAsk: (req, amt, days) => `नया कस्टम ऑर्डर: "${req}"\nआपका एजेंट ${amt} सुझाता है, ${days} दिन में तैयार।\nखरीदार को PayPal इनवॉइस भेजने के लिए हाँ लिखें, मना करने के लिए नहीं।`,
    commissionSent: (amt) => `${amt} का इनवॉइस PayPal से खरीदार को भेज दिया गया।`,
    commissionDeclined: "ठीक है, मना कर दिया। खरीदार को बता दिया गया है।",
  },
  mr: {
    help: "मला इथेच उत्तर द्या:\n📷 शिपिंग पावतीचा फोटो: मी ऑर्डर पाठवली म्हणून नोंदवेन आणि PayPal तुमचे पैसे देईल.\n✅ हो / ❌ नाही: माझ्या प्रश्नाचे उत्तर.\n📊 \"हिशोब\": तुमची विक्री.\n🌐 \"भाषा\": भाषा बदला.",
    languageMenu: "तुमची भाषा निवडा. क्रमांक लिहून उत्तर द्या:",
    languageSet: "झाले. आता मी तुम्हाला मराठीत लिहीन.",
    shipped: (title, tracking) => `पाठवले म्हणून नोंदवले: ${title}, ट्रॅकिंग ${tracking}. PayPal ने पैसे दिले आहेत.`,
    nothingToShip: "पाठवायची कोणतीही ऑर्डर बाकी नाही.",
    cantRead: "मला ट्रॅकिंग नंबर वाचता आला नाही. कृपया तो लिहून पाठवा, उदा. EE123456789IN.",
    refundDone: (amt) => `झाले. खरेदीदाराला ${amt} परत केले.`,
    refundKept: "ठीक आहे, परतावा नाही. खरेदीदाराला कळवले आहे.",
    nothingPending: "आत्ता तुमच्या उत्तरासाठी काहीही बाकी नाही.",
    status: (n, held, paid) => `पाठवायचे: ${n}\nPayPal कडे सुरक्षित: ${held}\nतुम्हाला मिळाले: ${paid}`,
    commissionAsk: (req, amt, days) => `नवीन कस्टम ऑर्डर: "${req}"\nतुमचा एजंट ${amt} सुचवतो, ${days} दिवसांत तयार.\nखरेदीदाराला PayPal बीजक पाठवण्यासाठी हो लिहा, नकार देण्यासाठी नाही.`,
    commissionSent: (amt) => `${amt} चे बीजक PayPal द्वारे खरेदीदाराला पाठवले.`,
    commissionDeclined: "ठीक आहे, नकार दिला. खरेदीदाराला कळवले आहे.",
  },
  bn: {
    help: "আমাকে এখানেই উত্তর দিন:\n📷 শিপিং রসিদের ছবি: আমি অর্ডারটি পাঠানো হিসেবে চিহ্নিত করব, PayPal আপনার টাকা ছেড়ে দেবে।\n✅ হ্যাঁ / ❌ না: আমার প্রশ্নের উত্তর।\n📊 \"হিসাব\": আপনার বিক্রি।\n🌐 \"ভাষা\": ভাষা বদলান।",
    languageMenu: "আপনার ভাষা বেছে নিন। নম্বর লিখে উত্তর দিন:",
    languageSet: "হয়ে গেছে। এখন থেকে আমি আপনাকে বাংলায় লিখব।",
    shipped: (title, tracking) => `পাঠানো হিসেবে চিহ্নিত: ${title}, ট্র্যাকিং ${tracking}। PayPal টাকা ছেড়ে দিয়েছে।`,
    nothingToShip: "পাঠানোর মতো কোনো অর্ডার বাকি নেই।",
    cantRead: "আমি ট্র্যাকিং নম্বর পড়তে পারিনি। অনুগ্রহ করে লিখে পাঠান, যেমন EE123456789IN।",
    refundDone: (amt) => `হয়ে গেছে। ক্রেতাকে ${amt} ফেরত দেওয়া হয়েছে।`,
    refundKept: "ঠিক আছে, কোনো ফেরত নয়। ক্রেতাকে জানানো হয়েছে।",
    nothingPending: "এই মুহূর্তে আপনার উত্তরের জন্য কিছু বাকি নেই।",
    status: (n, held, paid) => `পাঠাতে হবে: ${n}\nPayPal-এ নিরাপদে: ${held}\nআপনি পেয়েছেন: ${paid}`,
    commissionAsk: (req, amt, days) => `নতুন কাস্টম অর্ডার: "${req}"\nআপনার এজেন্ট ${amt} প্রস্তাব করছে, ${days} দিনে তৈরি।\nক্রেতাকে PayPal ইনভয়েস পাঠাতে হ্যাঁ লিখুন, না করতে না।`,
    commissionSent: (amt) => `${amt}-এর ইনভয়েস PayPal-এর মাধ্যমে ক্রেতাকে পাঠানো হয়েছে।`,
    commissionDeclined: "ঠিক আছে, না করা হয়েছে। ক্রেতাকে জানানো হয়েছে।",
  },
  ta: {
    help: "இங்கேயே பதில் அனுப்புங்கள்:\n📷 அனுப்பும் ரசீதின் புகைப்படம்: ஆர்டரை அனுப்பியதாகக் குறிப்பேன், PayPal உங்கள் பணத்தை விடுவிக்கும்.\n✅ ஆம் / ❌ இல்லை: என் கேள்விக்கு பதில்.\n📊 \"கணக்கு\": உங்கள் விற்பனை.\n🌐 \"மொழி\": மொழியை மாற்ற.",
    languageMenu: "உங்கள் மொழியைத் தேர்ந்தெடுங்கள். எண்ணை அனுப்புங்கள்:",
    languageSet: "முடிந்தது. இனி நான் உங்களுக்குத் தமிழில் எழுதுவேன்.",
    shipped: (title, tracking) => `அனுப்பியதாகக் குறிக்கப்பட்டது: ${title}, டிராக்கிங் ${tracking}. PayPal பணத்தை விடுவித்துவிட்டது.`,
    nothingToShip: "அனுப்ப வேண்டிய ஆர்டர் எதுவும் இல்லை.",
    cantRead: "டிராக்கிங் எண்ணைப் படிக்க முடியவில்லை. தயவுசெய்து அதை டைப் செய்யுங்கள், எ.கா. EE123456789IN.",
    refundDone: (amt) => `முடிந்தது. வாங்குபவருக்கு ${amt} திருப்பி அளிக்கப்பட்டது.`,
    refundKept: "சரி, பணத்தைத் திருப்பவில்லை. வாங்குபவருக்குத் தெரிவிக்கப்பட்டது.",
    nothingPending: "இப்போது உங்கள் பதிலுக்காக எதுவும் காத்திருக்கவில்லை.",
    status: (n, held, paid) => `அனுப்ப வேண்டியவை: ${n}\nPayPal-இல் பாதுகாப்பாக: ${held}\nஉங்களுக்குக் கிடைத்தது: ${paid}`,
    commissionAsk: (req, amt, days) => `புதிய தனிப்பயன் ஆர்டர்: "${req}"\nஉங்கள் ஏஜென்ட் ${amt} பரிந்துரைக்கிறது, ${days} நாட்களில் தயார்.\nவாங்குபவருக்கு PayPal விலைப்பட்டியல் அனுப்ப ஆம், மறுக்க இல்லை என்று பதிலளியுங்கள்.`,
    commissionSent: (amt) => `${amt} விலைப்பட்டியல் PayPal மூலம் வாங்குபவருக்கு அனுப்பப்பட்டது.`,
    commissionDeclined: "சரி, மறுக்கப்பட்டது. வாங்குபவருக்குத் தெரிவிக்கப்பட்டது.",
  },
  te: {
    help: "నాకు ఇక్కడే జవాబు ఇవ్వండి:\n📷 షిప్పింగ్ రసీదు ఫోటో: ఆర్డర్‌ను పంపినట్లు గుర్తిస్తాను, PayPal మీ డబ్బును విడుదల చేస్తుంది.\n✅ అవును / ❌ కాదు: నా ప్రశ్నకు జవాబు.\n📊 \"లెక్క\": మీ అమ్మకాలు.\n🌐 \"భాష\": భాష మార్చండి.",
    languageMenu: "మీ భాషను ఎంచుకోండి. సంఖ్యతో జవాబు ఇవ్వండి:",
    languageSet: "అయిపోయింది. ఇకపై నేను మీకు తెలుగులో రాస్తాను.",
    shipped: (title, tracking) => `పంపినట్లు గుర్తించాను: ${title}, ట్రాకింగ్ ${tracking}. PayPal డబ్బును విడుదల చేసింది.`,
    nothingToShip: "పంపాల్సిన ఆర్డర్ ఏదీ లేదు.",
    cantRead: "ట్రాకింగ్ నంబర్ చదవలేకపోయాను. దయచేసి టైప్ చేయండి, ఉదా. EE123456789IN.",
    refundDone: (amt) => `అయిపోయింది. కొనుగోలుదారుకు ${amt} తిరిగి ఇచ్చాము.`,
    refundKept: "సరే, రీఫండ్ లేదు. కొనుగోలుదారుకు తెలియజేశాము.",
    nothingPending: "ప్రస్తుతం మీ జవాబు కోసం ఏదీ వేచి లేదు.",
    status: (n, held, paid) => `పంపాల్సినవి: ${n}\nPayPal వద్ద సురక్షితం: ${held}\nమీకు వచ్చింది: ${paid}`,
    commissionAsk: (req, amt, days) => `కొత్త కస్టమ్ ఆర్డర్: "${req}"\nమీ ఏజెంట్ ${amt} సూచిస్తోంది, ${days} రోజుల్లో సిద్ధం.\nకొనుగోలుదారుకు PayPal ఇన్‌వాయిస్ పంపడానికి అవును, తిరస్కరించడానికి కాదు అని జవాబు ఇవ్వండి.`,
    commissionSent: (amt) => `${amt} ఇన్‌వాయిస్ PayPal ద్వారా కొనుగోలుదారుకు పంపబడింది.`,
    commissionDeclined: "సరే, తిరస్కరించాము. కొనుగోలుదారుకు తెలియజేశాము.",
  },
  gu: {
    help: "મને અહીં જ જવાબ આપો:\n📷 શિપિંગ રસીદનો ફોટો: હું ઓર્ડર મોકલ્યો તરીકે નોંધીશ અને PayPal તમારા પૈસા છોડશે.\n✅ હા / ❌ ના: મારા પ્રશ્નનો જવાબ.\n📊 \"હિસાબ\": તમારું વેચાણ.\n🌐 \"ભાષા\": ભાષા બદલો.",
    languageMenu: "તમારી ભાષા પસંદ કરો. નંબર લખીને જવાબ આપો:",
    languageSet: "થઈ ગયું. હવેથી હું તમને ગુજરાતીમાં લખીશ.",
    shipped: (title, tracking) => `મોકલ્યો તરીકે નોંધ્યું: ${title}, ટ્રેકિંગ ${tracking}. PayPal એ પૈસા છોડી દીધા છે.`,
    nothingToShip: "મોકલવા માટે કોઈ ઓર્ડર બાકી નથી.",
    cantRead: "હું ટ્રેકિંગ નંબર વાંચી શક્યો નહીં. કૃપા કરીને તે લખીને મોકલો, દા.ત. EE123456789IN.",
    refundDone: (amt) => `થઈ ગયું. ખરીદનારને ${amt} પરત કર્યા.`,
    refundKept: "ઠીક છે, કોઈ રિફંડ નહીં. ખરીદનારને જણાવ્યું છે.",
    nothingPending: "અત્યારે તમારા જવાબ માટે કંઈ બાકી નથી.",
    status: (n, held, paid) => `મોકલવાના: ${n}\nPayPal પાસે સુરક્ષિત: ${held}\nતમને મળ્યા: ${paid}`,
    commissionAsk: (req, amt, days) => `નવો કસ્ટમ ઓર્ડર: "${req}"\nતમારો એજન્ટ ${amt} સૂચવે છે, ${days} દિવસમાં તૈયાર.\nખરીદનારને PayPal ઇન્વૉઇસ મોકલવા હા, ના પાડવા ના લખો.`,
    commissionSent: (amt) => `${amt} નું ઇન્વૉઇસ PayPal દ્વારા ખરીદનારને મોકલ્યું.`,
    commissionDeclined: "ઠીક છે, ના પાડી. ખરીદનારને જણાવ્યું છે.",
  },
  kn: {
    help: "ನನಗೆ ಇಲ್ಲೇ ಉತ್ತರಿಸಿ:\n📷 ಶಿಪ್ಪಿಂಗ್ ರಸೀದಿಯ ಫೋಟೋ: ಆರ್ಡರ್ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ಗುರುತಿಸುತ್ತೇನೆ, PayPal ನಿಮ್ಮ ಹಣ ಬಿಡುಗಡೆ ಮಾಡುತ್ತದೆ.\n✅ ಹೌದು / ❌ ಇಲ್ಲ: ನನ್ನ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರ.\n📊 \"ಲೆಕ್ಕ\": ನಿಮ್ಮ ಮಾರಾಟ.\n🌐 \"ಭಾಷೆ\": ಭಾಷೆ ಬದಲಿಸಿ.",
    languageMenu: "ನಿಮ್ಮ ಭಾಷೆ ಆಯ್ಕೆಮಾಡಿ. ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಉತ್ತರಿಸಿ:",
    languageSet: "ಆಯಿತು. ಇನ್ನು ಮುಂದೆ ನಿಮಗೆ ಕನ್ನಡದಲ್ಲಿ ಬರೆಯುತ್ತೇನೆ.",
    shipped: (title, tracking) => `ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ: ${title}, ಟ್ರ್ಯಾಕಿಂಗ್ ${tracking}. PayPal ಹಣ ಬಿಡುಗಡೆ ಮಾಡಿದೆ.`,
    nothingToShip: "ಕಳುಹಿಸಬೇಕಾದ ಯಾವುದೇ ಆರ್ಡರ್ ಇಲ್ಲ.",
    cantRead: "ಟ್ರ್ಯಾಕಿಂಗ್ ಸಂಖ್ಯೆ ಓದಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಅದನ್ನು ಟೈಪ್ ಮಾಡಿ, ಉದಾ. EE123456789IN.",
    refundDone: (amt) => `ಆಯಿತು. ಖರೀದಿದಾರರಿಗೆ ${amt} ಮರುಪಾವತಿಸಲಾಗಿದೆ.`,
    refundKept: "ಸರಿ, ಮರುಪಾವತಿ ಇಲ್ಲ. ಖರೀದಿದಾರರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.",
    nothingPending: "ಈಗ ನಿಮ್ಮ ಉತ್ತರಕ್ಕಾಗಿ ಏನೂ ಕಾಯುತ್ತಿಲ್ಲ.",
    status: (n, held, paid) => `ಕಳುಹಿಸಬೇಕಾದವು: ${n}\nPayPal ನಲ್ಲಿ ಸುರಕ್ಷಿತ: ${held}\nನಿಮಗೆ ಬಂದದ್ದು: ${paid}`,
    commissionAsk: (req, amt, days) => `ಹೊಸ ಕಸ್ಟಮ್ ಆರ್ಡರ್: "${req}"\nನಿಮ್ಮ ಏಜೆಂಟ್ ${amt} ಸೂಚಿಸುತ್ತದೆ, ${days} ದಿನಗಳಲ್ಲಿ ಸಿದ್ಧ.\nಖರೀದಿದಾರರಿಗೆ PayPal ಇನ್‌ವಾಯ್ಸ್ ಕಳುಹಿಸಲು ಹೌದು, ನಿರಾಕರಿಸಲು ಇಲ್ಲ ಎಂದು ಉತ್ತರಿಸಿ.`,
    commissionSent: (amt) => `${amt} ಇನ್‌ವಾಯ್ಸ್ PayPal ಮೂಲಕ ಖರೀದಿದಾರರಿಗೆ ಕಳುಹಿಸಲಾಗಿದೆ.`,
    commissionDeclined: "ಸರಿ, ನಿರಾಕರಿಸಲಾಗಿದೆ. ಖರೀದಿದಾರರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.",
  },
  ml: {
    help: "എനിക്ക് ഇവിടെത്തന്നെ മറുപടി അയയ്ക്കൂ:\n📷 ഷിപ്പിംഗ് രസീതിന്റെ ഫോട്ടോ: ഓർഡർ അയച്ചതായി ഞാൻ രേഖപ്പെടുത്തും, PayPal നിങ്ങളുടെ പണം വിട്ടുനൽകും.\n✅ അതെ / ❌ ഇല്ല: എന്റെ ചോദ്യത്തിന് മറുപടി.\n📊 \"കണക്ക്\": നിങ്ങളുടെ വിൽപ്പന.\n🌐 \"ഭാഷ\": ഭാഷ മാറ്റാൻ.",
    languageMenu: "നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കൂ. നമ്പർ അയച്ച് മറുപടി നൽകൂ:",
    languageSet: "ശരി. ഇനി ഞാൻ നിങ്ങൾക്ക് മലയാളത്തിൽ എഴുതാം.",
    shipped: (title, tracking) => `അയച്ചതായി രേഖപ്പെടുത്തി: ${title}, ട്രാക്കിംഗ് ${tracking}. PayPal പണം വിട്ടുനൽകി.`,
    nothingToShip: "അയയ്ക്കാനുള്ള ഓർഡറുകളൊന്നുമില്ല.",
    cantRead: "ട്രാക്കിംഗ് നമ്പർ വായിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി അത് ടൈപ്പ് ചെയ്യൂ, ഉദാ. EE123456789IN.",
    refundDone: (amt) => `ശരി. വാങ്ങുന്നയാൾക്ക് ${amt} തിരികെ നൽകി.`,
    refundKept: "ശരി, റീഫണ്ട് ഇല്ല. വാങ്ങുന്നയാളെ അറിയിച്ചു.",
    nothingPending: "ഇപ്പോൾ നിങ്ങളുടെ മറുപടിക്കായി ഒന്നും കാത്തിരിക്കുന്നില്ല.",
    status: (n, held, paid) => `അയയ്ക്കാനുള്ളത്: ${n}\nPayPal-ൽ സുരക്ഷിതം: ${held}\nനിങ്ങൾക്ക് ലഭിച്ചത്: ${paid}`,
    commissionAsk: (req, amt, days) => `പുതിയ കസ്റ്റം ഓർഡർ: "${req}"\nനിങ്ങളുടെ ഏജന്റ് ${amt} നിർദ്ദേശിക്കുന്നു, ${days} ദിവസത്തിനുള്ളിൽ തയ്യാർ.\nവാങ്ങുന്നയാൾക്ക് PayPal ഇൻവോയ്സ് അയയ്ക്കാൻ അതെ, നിരസിക്കാൻ ഇല്ല എന്ന് മറുപടി നൽകൂ.`,
    commissionSent: (amt) => `${amt} ഇൻവോയ്സ് PayPal വഴി വാങ്ങുന്നയാൾക്ക് അയച്ചു.`,
    commissionDeclined: "ശരി, നിരസിച്ചു. വാങ്ങുന്നയാളെ അറിയിച്ചു.",
  },
  pa: {
    help: "ਮੈਨੂੰ ਇੱਥੇ ਹੀ ਜਵਾਬ ਦਿਓ:\n📷 ਸ਼ਿਪਿੰਗ ਰਸੀਦ ਦੀ ਫ਼ੋਟੋ: ਮੈਂ ਆਰਡਰ ਭੇਜਿਆ ਹੋਇਆ ਮਾਰਕ ਕਰਾਂਗਾ ਅਤੇ PayPal ਤੁਹਾਡੇ ਪੈਸੇ ਜਾਰੀ ਕਰੇਗਾ।\n✅ ਹਾਂ / ❌ ਨਹੀਂ: ਮੇਰੇ ਸਵਾਲ ਦਾ ਜਵਾਬ।\n📊 \"ਹਿਸਾਬ\": ਤੁਹਾਡੀ ਵਿਕਰੀ।\n🌐 \"ਭਾਸ਼ਾ\": ਭਾਸ਼ਾ ਬਦਲੋ।",
    languageMenu: "ਆਪਣੀ ਭਾਸ਼ਾ ਚੁਣੋ। ਨੰਬਰ ਲਿਖ ਕੇ ਜਵਾਬ ਦਿਓ:",
    languageSet: "ਹੋ ਗਿਆ। ਹੁਣ ਤੋਂ ਮੈਂ ਤੁਹਾਨੂੰ ਪੰਜਾਬੀ ਵਿੱਚ ਲਿਖਾਂਗਾ।",
    shipped: (title, tracking) => `ਭੇਜਿਆ ਹੋਇਆ ਮਾਰਕ ਕੀਤਾ: ${title}, ਟ੍ਰੈਕਿੰਗ ${tracking}। PayPal ਨੇ ਪੈਸੇ ਜਾਰੀ ਕਰ ਦਿੱਤੇ ਹਨ।`,
    nothingToShip: "ਭੇਜਣ ਲਈ ਕੋਈ ਆਰਡਰ ਬਾਕੀ ਨਹੀਂ ਹੈ।",
    cantRead: "ਮੈਂ ਟ੍ਰੈਕਿੰਗ ਨੰਬਰ ਨਹੀਂ ਪੜ੍ਹ ਸਕਿਆ। ਕਿਰਪਾ ਕਰਕੇ ਲਿਖ ਕੇ ਭੇਜੋ, ਜਿਵੇਂ EE123456789IN।",
    refundDone: (amt) => `ਹੋ ਗਿਆ। ਖਰੀਦਦਾਰ ਨੂੰ ${amt} ਵਾਪਸ ਕਰ ਦਿੱਤੇ ਗਏ।`,
    refundKept: "ਠੀਕ ਹੈ, ਕੋਈ ਰਿਫੰਡ ਨਹੀਂ। ਖਰੀਦਦਾਰ ਨੂੰ ਦੱਸ ਦਿੱਤਾ ਗਿਆ ਹੈ।",
    nothingPending: "ਇਸ ਵੇਲੇ ਤੁਹਾਡੇ ਜਵਾਬ ਲਈ ਕੁਝ ਬਾਕੀ ਨਹੀਂ ਹੈ।",
    status: (n, held, paid) => `ਭੇਜਣੇ ਹਨ: ${n}\nPayPal ਕੋਲ ਸੁਰੱਖਿਅਤ: ${held}\nਤੁਹਾਨੂੰ ਮਿਲੇ: ${paid}`,
    commissionAsk: (req, amt, days) => `ਨਵਾਂ ਕਸਟਮ ਆਰਡਰ: "${req}"\nਤੁਹਾਡਾ ਏਜੰਟ ${amt} ਸੁਝਾਉਂਦਾ ਹੈ, ${days} ਦਿਨਾਂ ਵਿੱਚ ਤਿਆਰ।\nਖਰੀਦਦਾਰ ਨੂੰ PayPal ਇਨਵੌਇਸ ਭੇਜਣ ਲਈ ਹਾਂ, ਇਨਕਾਰ ਲਈ ਨਹੀਂ ਲਿਖੋ।`,
    commissionSent: (amt) => `${amt} ਦਾ ਇਨਵੌਇਸ PayPal ਰਾਹੀਂ ਖਰੀਦਦਾਰ ਨੂੰ ਭੇਜ ਦਿੱਤਾ ਗਿਆ।`,
    commissionDeclined: "ਠੀਕ ਹੈ, ਇਨਕਾਰ ਕਰ ਦਿੱਤਾ। ਖਰੀਦਦਾਰ ਨੂੰ ਦੱਸ ਦਿੱਤਾ ਗਿਆ ਹੈ।",
  },
  or: {
    help: "ମୋତେ ଏଠାରେ ଉତ୍ତର ଦିଅନ୍ତୁ:\n📷 ସିପିଂ ରସିଦର ଫଟୋ: ମୁଁ ଅର୍ଡରକୁ ପଠାଯାଇଛି ବୋଲି ଚିହ୍ନିତ କରିବି ଏବଂ PayPal ଆପଣଙ୍କ ଟଙ୍କା ଛାଡ଼ିବ।\n✅ ହଁ / ❌ ନା: ମୋ ପ୍ରଶ୍ନର ଉତ୍ତର।\n📊 \"ହିସାବ\": ଆପଣଙ୍କ ବିକ୍ରି।\n🌐 \"ଭାଷା\": ଭାଷା ବଦଳାନ୍ତୁ।",
    languageMenu: "ଆପଣଙ୍କ ଭାଷା ବାଛନ୍ତୁ। ନମ୍ବର ଲେଖି ଉତ୍ତର ଦିଅନ୍ତୁ:",
    languageSet: "ହୋଇଗଲା। ଏଣିକି ମୁଁ ଆପଣଙ୍କୁ ଓଡ଼ିଆରେ ଲେଖିବି।",
    shipped: (title, tracking) => `ପଠାଯାଇଛି ବୋଲି ଚିହ୍ନିତ: ${title}, ଟ୍ରାକିଂ ${tracking}। PayPal ଟଙ୍କା ଛାଡ଼ିଦେଇଛି।`,
    nothingToShip: "ପଠାଇବା ପାଇଁ କୌଣସି ଅର୍ଡର ବାକି ନାହିଁ।",
    cantRead: "ମୁଁ ଟ୍ରାକିଂ ନମ୍ବର ପଢ଼ିପାରିଲି ନାହିଁ। ଦୟାକରି ଲେଖି ପଠାନ୍ତୁ, ଯେପରି EE123456789IN।",
    refundDone: (amt) => `ହୋଇଗଲା। କ୍ରେତାଙ୍କୁ ${amt} ଫେରସ୍ତ କରାଗଲା।`,
    refundKept: "ଠିକ ଅଛି, କୌଣସି ଫେରସ୍ତ ନାହିଁ। କ୍ରେତାଙ୍କୁ ଜଣାଇ ଦିଆଯାଇଛି।",
    nothingPending: "ଏବେ ଆପଣଙ୍କ ଉତ୍ତର ପାଇଁ କିଛି ବାକି ନାହିଁ।",
    status: (n, held, paid) => `ପଠାଇବାକୁ: ${n}\nPayPal ପାଖରେ ସୁରକ୍ଷିତ: ${held}\nଆପଣ ପାଇଛନ୍ତି: ${paid}`,
    commissionAsk: (req, amt, days) => `ନୂଆ କଷ୍ଟମ ଅର୍ଡର: "${req}"\nଆପଣଙ୍କ ଏଜେଣ୍ଟ ${amt} ପରାମର୍ଶ ଦେଉଛି, ${days} ଦିନରେ ପ୍ରସ୍ତୁତ।\nକ୍ରେତାଙ୍କୁ PayPal ଇନଭଏସ ପଠାଇବାକୁ ହଁ, ମନା କରିବାକୁ ନା ଲେଖନ୍ତୁ।`,
    commissionSent: (amt) => `${amt} ର ଇନଭଏସ PayPal ମାଧ୍ୟମରେ କ୍ରେତାଙ୍କୁ ପଠାଗଲା।`,
    commissionDeclined: "ଠିକ ଅଛି, ମନା କରାଗଲା। କ୍ରେତାଙ୍କୁ ଜଣାଇ ଦିଆଯାଇଛି।",
  },
};

/** "Yes" and "no" in every seller language, plus the common romanised forms and emoji. */
const YES = ["yes", "y", "ok", "okay", "haan", "han", "ha", "haa", "ji", "theek", "हाँ", "हां", "हो", "হ্যাঁ", "হা", "ஆம்", "சரி", "అవును", "సరే", "હા", "ಹೌದು", "ಸರಿ", "അതെ", "ശരി", "ਹਾਂ", "ହଁ", "👍", "✅"];
const NO = ["no", "n", "nahi", "nahin", "na", "nako", "नहीं", "नही", "नाही", "ना", "না", "இல்லை", "వద్దు", "కాదు", "ના", "ಇಲ್ಲ", "ಬೇಡ", "ഇല്ല", "വേണ്ട", "ਨਹੀਂ", "ନା", "👎", "❌"];
const STATUS = ["status", "hisab", "hisaab", "हिसाब", "हिशोब", "হিসাব", "கணக்கு", "లెక్క", "હિસાબ", "ಲೆಕ್ಕ", "കണക്ക്", "ਹਿਸਾਬ", "ହିସାବ"];
const LANGUAGE = ["language", "bhasha", "bhasa", "भाषा", "ভাষা", "மொழி", "భాష", "ભાષા", "ಭಾಷೆ", "ഭാഷ", "ਭਾਸ਼ਾ", "ଭାଷା"];
const HELP = ["help", "madad", "मदद", "?", "hi", "hello", "namaste", "नमस्ते"];

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.!,।?]+$/u, "")
    .trim();

/** Recognises one-word replies without a model call. */
export function quickIntent(text: string): "yes" | "no" | "status" | "language" | "help" | null {
  const w = words(text);
  if (!w) return null;
  if (YES.includes(w)) return "yes";
  if (NO.includes(w)) return "no";
  if (STATUS.includes(w)) return "status";
  if (LANGUAGE.includes(w)) return "language";
  if (HELP.includes(w) || text.trim() === "?") return "help";
  return null;
}

/** A tracking number typed as text: India Post style (EE123456789IN) or a long letter/digit code. */
export function findTrackingNumber(text: string): string | null {
  const upu = text.toUpperCase().match(/\b[A-Z]{2}\s?\d{9}\s?[A-Z]{2}\b/);
  if (upu) return upu[0].replace(/\s/g, "");
  const generic = text.toUpperCase().match(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{10,22}\b/);
  return generic ? generic[0] : null;
}

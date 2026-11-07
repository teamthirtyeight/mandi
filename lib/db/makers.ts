// Demo makers for "Meet the maker" on listing pages. The makers are fictional;
// their crafts, places and techniques are real. Photos show the craft (not the
// maker) and come from Wikimedia Commons under the licences credited here.

export interface Maker {
  name: string;
  city: string;
  region: string;
  craft: string;
  story: string;
  quote: string;
  photoUrl: string;
  photoCredit: string;
  photoSource: string;
}

const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

export const MAKERS: Record<string, Maker> = {
  meera: {
    name: "Meera",
    city: "Varanasi",
    region: "Uttar Pradesh",
    craft: "Banarasi silk weaving",
    story:
      "Meera learned to weave on her grandfather's pit loom in Madanpura, the weavers' quarter of Varanasi. A scarf takes her about four days: one to set the warp, three at the loom lifting the zari pattern thread by thread. Power looms now copy Banarasi designs for a fraction of the price, and many of her neighbours have left the trade. Selling abroad through Mandi keeps both of her looms working.",
    quote: "When the zari catches the light, I know the four days were worth it.",
    photoUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/13/India_-_Varanasi_loom_-_0985.jpg/1280px-India_-_Varanasi_loom_-_0985.jpg",
    photoCredit: "A handloom in Varanasi. Photo: Jorge Royan, CC BY-SA 3.0",
    photoSource: commons("India_-_Varanasi_loom_-_0985.jpg"),
  },
  arjun: {
    name: "Arjun",
    city: "Jaipur",
    region: "Rajasthan",
    craft: "Indigo Dabu block printing",
    story:
      "Arjun's family has printed cloth in Bagru, outside Jaipur, for five generations. He carves his own teak blocks, resists each pattern with dabu, a paste of river clay and gum, then dyes the cloth in indigo vats that take weeks to ferment. Every length is printed, dyed and dried in the sun by hand, so no two pieces match exactly.",
    quote: "The clay cracks a little differently every time. That crack is the signature.",
    photoUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4c/Wooden_Block_prints_Jaipur.jpg/1280px-Wooden_Block_prints_Jaipur.jpg",
    photoCredit: "Wooden printing blocks in Jaipur. Photo: Silverrays, CC BY-SA 4.0",
    photoSource: "https://commons.wikimedia.org/wiki/File:Wooden_Block_prints_Jaipur.jpg",
  },
  fatima: {
    name: "Fatima",
    city: "Srinagar",
    region: "Kashmir",
    craft: "Sozni embroidery",
    story:
      "Fatima embroiders sozni, the fine needlework of Kashmir, at a window in Srinagar's old city where the winter light is best. A single paisley border can take her a month; a full shawl, most of a winter. She learned from her mother and now teaches three girls from her lane, so the stitch stays alive.",
    quote: "My needle is thinner than a hair. Patience is the real tool.",
    photoUrl:
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/60/Embroidery_on_a_wollen_shawl_from_Kashmir_02.jpg/1280px-Embroidery_on_a_wollen_shawl_from_Kashmir_02.jpg",
    photoCredit: "Embroidery on a woollen shawl from Kashmir. Photo: Kritzolina, CC BY-SA 4.0",
    photoSource: commons("Embroidery_on_a_wollen_shawl_from_Kashmir_02.jpg"),
  },
  lakshmi: {
    name: "Lakshmi",
    city: "Kanchipuram",
    region: "Tamil Nadu",
    craft: "Kanjivaram silk weaving",
    story:
      "Lakshmi and her husband share a three-shuttle loom in Kanchipuram, the temple town known for heavy silk saris. The body and the border are woven separately and interlocked by hand, which is why a true Kanjivaram border never comes apart. One sari takes the two of them twelve to fifteen days.",
    quote: "A Kanjivaram is woven to be handed down. My grandmother's still shines.",
    photoUrl:
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1b/Silk_Sari_Weaving_at_Kanchipuram%2C_Tamil_Nadu.jpg/1280px-Silk_Sari_Weaving_at_Kanchipuram%2C_Tamil_Nadu.jpg",
    photoCredit: "Silk sari weaving in Kanchipuram. Photo: McKay Savage, CC BY 2.0",
    photoSource: commons("Silk_Sari_Weaving_at_Kanchipuram,_Tamil_Nadu.jpg"),
  },
  shampa: {
    name: "Shampa",
    city: "Phulia",
    region: "West Bengal",
    craft: "Tant cotton weaving",
    story:
      "Shampa weaves fine cotton tant saris in Phulia, a village of weavers in Nadia district. The little motifs are added by hand with a bamboo needle as the cloth grows on the loom, the way her family has worked since they came from Dhaka in 1947. Her saris are light enough to wear through a Bengal summer.",
    quote: "Cotton has to breathe, so I weave it light enough to see through.",
    photoUrl:
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/08/Lakshmi_Textile_Tant_Workshop_Interior_-_2_Natun_Phulia_-_Nadia_2016-11-12_1805.JPG/1280px-Lakshmi_Textile_Tant_Workshop_Interior_-_2_Natun_Phulia_-_Nadia_2016-11-12_1805.JPG",
    photoCredit: "A tant workshop in Phulia, Nadia. Photo: Biswarup Ganguly, CC BY 3.0",
    photoSource: commons("Lakshmi_Textile_Tant_Workshop_Interior_-_2_Natun_Phulia_-_Nadia_2016-11-12_1805.JPG"),
  },
  gurpreet: {
    name: "Gurpreet",
    city: "Patiala",
    region: "Punjab",
    craft: "Phulkari embroidery",
    story:
      "Gurpreet stitches phulkari, Punjab's flower work, in floss silk on hand-spun cotton, working from the back of the cloth so every flower stays even. Her grandmother embroidered a bagh for every wedding in the family. Gurpreet now runs a circle of twelve women in Patiala who share the orders and the stitching.",
    quote: "Every stitch is counted. Lose the count and the flower goes crooked.",
    photoUrl:
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cb/A_Phulkari_with_traditional_flower_pattern_on_unworked_background.jpg/1280px-A_Phulkari_with_traditional_flower_pattern_on_unworked_background.jpg",
    photoCredit: "A phulkari with a traditional flower pattern. Photo: Chiswick Chap, CC BY-SA 4.0",
    photoSource: commons("A_Phulkari_with_traditional_flower_pattern_on_unworked_background.jpg"),
  },
  bijay: {
    name: "Bijay",
    city: "Raghurajpur",
    region: "Odisha",
    craft: "Pattachitra painting",
    story:
      "Bijay paints pattachitra in Raghurajpur, a heritage village near Puri where nearly every house is a studio. He makes the canvas himself from cotton cloth, chalk and tamarind gum, grinds his colours from stone, conch shell and lamp soot, and paints the old Jagannath stories with the finest brushes he can make.",
    quote: "The colours come from the earth, so the painting will outlast me.",
    photoUrl:
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/49/Pattachitra_Painting_%2816419912954%29.jpg/1280px-Pattachitra_Painting_%2816419912954%29.jpg",
    photoCredit: "A pattachitra painting from Odisha. Photo: Mike Prince, CC BY 2.0",
    photoSource: "https://commons.wikimedia.org/wiki/File:Pattachitra_Painting_(16419912954).jpg",
  },
  hetal: {
    name: "Hetal",
    city: "Bhuj",
    region: "Gujarat",
    craft: "Ahir mirror embroidery",
    story:
      "Hetal belongs to the Ahir community of Kutch, whose embroidery is all chain stitch, bright silk thread and tiny mirrors. She started stitching at eight, for her own dowry. Today she works with a women's cooperative in Bhuj that sells to buyers around the world, and the money pays for her daughters' schooling.",
    quote: "The mirrors are there to throw the light back. That is what we were taught.",
    photoUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c4/Ahir_Embroidery_From_Kutch.jpg/1280px-Ahir_Embroidery_From_Kutch.jpg",
    photoCredit: "Ahir embroidery from Kutch. Photo: Fewword, CC BY-SA 4.0",
    photoSource: commons("Ahir_Embroidery_From_Kutch.jpg"),
  },
};

/** The maker fields for a seller insert. */
export function makerFields(key: keyof typeof MAKERS) {
  const m = MAKERS[key];
  return {
    region: m.region,
    craft: m.craft,
    story: m.story,
    quote: m.quote,
    photoUrl: m.photoUrl,
    photoCredit: m.photoCredit,
    photoSource: m.photoSource,
  };
}

const gbp = (pounds: number) => Math.round(pounds * 100);

/** Makers added beyond the original three demo sellers. */
export const REGIONAL_SELLERS = ["lakshmi", "shampa", "gurpreet", "bijay", "hetal"] as const;

/** Account details for the regional makers (no logins; sandbox payee placeholders). */
export const MAKER_ACCOUNTS: Record<(typeof REGIONAL_SELLERS)[number], { name: string; city: string; country: string; language: string; shipByDays: number; transitDays: number; paypalMerchantEmail: string }> = {
  lakshmi: { name: "Lakshmi", city: "Kanchipuram", country: "IN", language: "ta", shipByDays: 3, transitDays: 8, paypalMerchantEmail: "lakshmi@example.com" },
  shampa: { name: "Shampa", city: "Phulia", country: "IN", language: "bn", shipByDays: 3, transitDays: 8, paypalMerchantEmail: "shampa@example.com" },
  gurpreet: { name: "Gurpreet", city: "Patiala", country: "IN", language: "pa", shipByDays: 2, transitDays: 7, paypalMerchantEmail: "gurpreet@example.com" },
  bijay: { name: "Bijay", city: "Raghurajpur", country: "IN", language: "or", shipByDays: 3, transitDays: 9, paypalMerchantEmail: "bijay@example.com" },
  hetal: { name: "Hetal", city: "Bhuj", country: "IN", language: "gu", shipByDays: 2, transitDays: 8, paypalMerchantEmail: "hetal@example.com" },
};

/** Their pieces. None mention scarves, so they don't change the scarf demo. */
export const REGIONAL_LISTINGS = [
  {
    maker: "lakshmi" as const,
    title: "Kanjivaram silk sari, temple border, maroon and gold",
    description: "Heavy mulberry silk with a zari temple border, woven on a three-shuttle loom and interlocked by hand.",
    category: "sari",
    materials: "mulberry silk, zari",
    listPriceMinor: gbp(240),
    floorPriceMinor: gbp(190),
  },
  {
    maker: "shampa" as const,
    title: "Handwoven tant cotton sari, white with red border",
    description: "Fine Phulia cotton with small hand-inserted motifs. Light and cool for summer.",
    category: "sari",
    materials: "cotton",
    listPriceMinor: gbp(85),
    floorPriceMinor: gbp(62),
  },
  {
    maker: "gurpreet" as const,
    title: "Phulkari bagh dupatta, golden floss on rust cotton",
    description: "Hand-embroidered phulkari covering the whole cloth, stitched from the back in floss on khaddar cotton.",
    category: "dupatta",
    materials: "cotton, floss",
    listPriceMinor: gbp(130),
    floorPriceMinor: gbp(98),
  },
  {
    maker: "bijay" as const,
    title: "Pattachitra painting, Krishna's Raas Leela",
    description: "Painted on a hand-prepared cloth canvas with stone, conch and soot colours. About 45 by 30 cm.",
    category: "art",
    materials: "cotton canvas, natural pigments",
    listPriceMinor: gbp(90),
    floorPriceMinor: gbp(64),
  },
  {
    maker: "hetal" as const,
    title: "Ahir mirror-work wall hanging",
    description: "Chain-stitch embroidery with small hand-set mirrors on cotton, made in a Bhuj cooperative.",
    category: "home",
    materials: "cotton, mirrors, thread",
    listPriceMinor: gbp(70),
    floorPriceMinor: gbp(50),
  },
  {
    maker: "hetal" as const,
    title: "Ahir embroidered cushion cover, mirrors on indigo",
    description: "Hand-stitched mirror work on an indigo cotton cushion cover, 40 by 40 cm.",
    category: "home",
    materials: "cotton, mirrors, thread",
    listPriceMinor: gbp(38),
    floorPriceMinor: gbp(27),
  },
];

/**
 * Product photos for the demo listings, by listing title, from Wikimedia
 * Commons with the credit each licence asks for (shown under the photo).
 * Meera's cushion cover has none and keeps its woven swatch.
 */
export const PRODUCT_PHOTOS: Record<string, { url: string; credit: string; source: string }> = {
  "Handwoven Banarasi silk scarf, rose and gold": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a9/Saree_on_display_at_Dilli_Haat.JPG/1280px-Saree_on_display_at_Dilli_Haat.JPG",
    credit: "Photo: Ekabhishek, CC BY-SA 3.0",
    source: "https://commons.wikimedia.org/wiki/File:Saree_on_display_at_Dilli_Haat.JPG",
  },
  "Banarasi silk stole, peacock blue": {
    url: "https://upload.wikimedia.org/wikipedia/commons/4/4e/%27Sari%27_from_Varanasi_%28north-central_India%29%2C_silk_and_gold-wrapped_silk_yarn_with_supplementary_weft_brocade.jpg",
    credit: "Photo: unknown artist, Public domain",
    source: "https://commons.wikimedia.org/wiki/File:%27Sari%27_from_Varanasi_(north-central_India),_silk_and_gold-wrapped_silk_yarn_with_supplementary_weft_brocade.jpg",
  },
  "Indigo block-printed silk scarf": {
    url: "https://upload.wikimedia.org/wikipedia/commons/f/f5/Dabu_Printed_Fabric.jpg",
    credit: "Photo: Aayushimundada, CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Dabu_Printed_Fabric.jpg",
  },
  "Block-printed cotton tablecloth": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b8/Bagh-print-silk-stole-sample.jpg/1280px-Bagh-print-silk-stole-sample.jpg",
    credit: "Photo: Mrqd9, CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Bagh-print-silk-stole-sample.jpg",
  },
  "Sozni-embroidered silk-wool scarf": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f2/Kashmiri_shawls.jpg/1280px-Kashmiri_shawls.jpg",
    credit: "Photo: Owais Khursheed, CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Kashmiri_shawls.jpg",
  },
  "Embroidered wool shawl": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3f/Embroidery_on_a_wollen_shawl_from_Kashmir_04.jpg/1280px-Embroidery_on_a_wollen_shawl_from_Kashmir_04.jpg",
    credit: "Photo: Kritzolina, CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Embroidery_on_a_wollen_shawl_from_Kashmir_04.jpg",
  },
  "Embroidered silk pouch": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c7/Embroidery_on_a_wollen_shawl_from_Kashmir_01.jpg/1280px-Embroidery_on_a_wollen_shawl_from_Kashmir_01.jpg",
    credit: "Photo: Kritzolina, CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Embroidery_on_a_wollen_shawl_from_Kashmir_01.jpg",
  },
  "Kanjivaram silk sari, temple border, maroon and gold": {
    url: "https://upload.wikimedia.org/wikipedia/commons/8/83/Silk_saree_on_the_making_at_Kanchipuram_%287642281054%29.jpg",
    credit: "Photo: Kamal Venkit, CC BY 2.0",
    source: "https://commons.wikimedia.org/wiki/File:Silk_saree_on_the_making_at_Kanchipuram_(7642281054).jpg",
  },
  "Handwoven tant cotton sari, white with red border": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/96/A_traditional_Bengali_Tant_Sari.jpg/1280px-A_traditional_Bengali_Tant_Sari.jpg",
    credit: "Photo: Billjones94, CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:A_traditional_Bengali_Tant_Sari.jpg",
  },
  "Phulkari bagh dupatta, golden floss on rust cotton": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/71/Contemporary_Phulkari_design.jpg/1280px-Contemporary_Phulkari_design.jpg",
    credit: "Photo: Sheebamadanloewinger, CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Contemporary_Phulkari_design.jpg",
  },
  "Pattachitra painting, Krishna's Raas Leela": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3a/Pattachitra_Painting_%2817041543331%29.jpg/1280px-Pattachitra_Painting_%2817041543331%29.jpg",
    credit: "Photo: Mike Prince, CC BY 2.0",
    source: "https://commons.wikimedia.org/wiki/File:Pattachitra_Painting_(17041543331).jpg",
  },
  "Ahir mirror-work wall hanging": {
    url: "https://upload.wikimedia.org/wikipedia/commons/4/4f/Embroidered_hanging%2C_Kutch_%28western_India.jpg",
    credit: "Photo: unknown artist, CC0",
    source: "https://commons.wikimedia.org/wiki/File:Embroidered_hanging,_Kutch_(western_India.jpg",
  },
  "Ahir embroidered cushion cover, mirrors on indigo": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/Kutchi_Embroidery_3.png/1280px-Kutchi_Embroidery_3.png",
    credit: "Photo: Michel Cecil, CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Kutchi_Embroidery_3.png",
  },
};

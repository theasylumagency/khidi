import { z } from "zod";
import type {
  ProductTypeAiResearchContract,
  ProductTypeAttributeFieldDef,
  ProductTypePhotoInstructionSlot,
  SkuAttributeValueEntry
} from "@khidi/db";
import { AppError } from "@khidi/shared";

export const TOP_LEVEL_CATEGORY_KEYS = [
  "AGRI_MACHINERY",
  "GARDEN_FORESTRY",
  "SPRAYING_IRRIGATION",
  "FARM_EQUIPMENT",
  "WORKSHOP_CONSTRUCTION",
  "ATV_TRANSPORT",
  "TIRES_WHEELS",
  "SPARE_PARTS_ACCESSORIES",
  "UNCLASSIFIED"
] as const;

export type TopLevelCategoryKey = (typeof TOP_LEVEL_CATEGORY_KEYS)[number];

export interface CategorySeedDef {
  key: TopLevelCategoryKey;
  nameKa: string;
  nameEn: string;
  isUnclassified: boolean;
  sortOrder: number;
}

/**
 * §5.7 Taxonomy: 8 public top-level categories + 1 internal UNCLASSIFIED category.
 * There is no public "Miscellaneous / სხვადასხვა" category.
 */
export const INITIAL_CATEGORIES: readonly CategorySeedDef[] = [
  {
    key: "AGRI_MACHINERY",
    nameKa: "სასოფლო-სამეურნეო ტექნიკა",
    nameEn: "Agricultural machinery",
    isUnclassified: false,
    sortOrder: 10
  },
  {
    key: "GARDEN_FORESTRY",
    nameKa: "ბაღისა და ტყის ტექნიკა",
    nameEn: "Garden & forestry",
    isUnclassified: false,
    sortOrder: 20
  },
  {
    key: "SPRAYING_IRRIGATION",
    nameKa: "შესხურება და სარწყავი",
    nameEn: "Spraying & irrigation",
    isUnclassified: false,
    sortOrder: 30
  },
  {
    key: "FARM_EQUIPMENT",
    nameKa: "ფერმის დანადგარები",
    nameEn: "Farm equipment",
    isUnclassified: false,
    sortOrder: 40
  },
  {
    key: "WORKSHOP_CONSTRUCTION",
    nameKa: "სახელოსნო და სამშენებლო",
    nameEn: "Workshop & construction",
    isUnclassified: false,
    sortOrder: 50
  },
  {
    key: "ATV_TRANSPORT",
    nameKa: "კვადროციკლები და ტრანსპორტი",
    nameEn: "ATV & transport",
    isUnclassified: false,
    sortOrder: 60
  },
  {
    key: "TIRES_WHEELS",
    nameKa: "საბურავები და ბორბლები",
    nameEn: "Tires & wheels",
    isUnclassified: false,
    sortOrder: 70
  },
  {
    key: "SPARE_PARTS_ACCESSORIES",
    nameKa: "სათადარიგო ნაწილები და აქსესუარები",
    nameEn: "Spare parts & accessories",
    isUnclassified: false,
    sortOrder: 80
  },
  {
    key: "UNCLASSIFIED",
    nameKa: "არაკლასიფიცირებული (შიდა განხილვა)",
    nameEn: "Unclassified (Internal Review)",
    isUnclassified: true,
    sortOrder: 999
  }
] as const;

export const INITIAL_PRODUCT_TYPE_KEYS = [
  "MOTOBLOCK",
  "EARTH_AUGER",
  "AGRI_ATTACHMENT",
  "TRAILER",
  "BRUSHCUTTER",
  "LAWN_MOWER",
  "CHAINSAW",
  "SHREDDER",
  "BLOWER",
  "SPRAYER",
  "WATER_PUMP",
  "IRRIGATION_ACCESSORY",
  "FEED_MILL",
  "MILKING_MACHINE",
  "FARM_PROCESSOR",
  "POWER_TOOL",
  "WELDER",
  "COMPRESSOR",
  "CONCRETE_MIXER",
  "JACK",
  "WHEELBARROW",
  "HAND_TOOL",
  "ATV",
  "TRICYCLE",
  "TIRE",
  "TUBE",
  "WHEEL_RIM",
  "ENGINE",
  "SPARE_PART",
  "ACCESSORY"
] as const;

export type InitialProductTypeKey = (typeof INITIAL_PRODUCT_TYPE_KEYS)[number];

export interface ProductTypeSeedDef {
  key: string;
  defaultCategoryKey: TopLevelCategoryKey;
  nameKa: string;
  nameEn: string;
  searchAliasesKa: string[];
  searchAliasesEn: string[];
  namingTemplateKa: string;
  namingTemplateEn: string;
  attributeSchema: ProductTypeAttributeFieldDef[];
  photoInstructions: ProductTypePhotoInstructionSlot[];
  aiResearchContract: ProductTypeAiResearchContract;
}

function buildDefaultPhotoInstructions(
  typeNameKa: string,
  typeNameEn: string,
  plateHintKa = "საიდენტიფიკაციო ფირფიტა (შილდიკი), მოდელის კოდი ან შტრიხკოდი ახლო ხედით",
  plateHintEn = "Close-up of model plate, factory code, or barcode"
): ProductTypePhotoInstructionSlot[] {
  return [
    {
      slot: "MAIN",
      titleKa: "მთავარი ხედი (3/4 კუთხით)",
      titleEn: "Main 3/4 View",
      guidanceKa: `გადაუღეთ ${typeNameKa}-ს სრული კორპუსი წინა-გვერდითა 3/4 კუთხით, კარგ განათებაში.`,
      guidanceEn: `Capture full ${typeNameEn} body from a clean front-side 3/4 angle in good lighting.`,
      required: true
    },
    {
      slot: "SECONDARY",
      titleKa: "მეორე კუთხე / სამუშაო კვანძი",
      titleEn: "Secondary Angle / Working Assembly",
      guidanceKa: "გადაუღეთ უკანა/მეორე მხარე ან სამუშაო ორგანო (ძრავა, გადაცემათა კოლოფი, სამაგრი).",
      guidanceEn: "Capture rear/alternate angle or key working assembly (engine, gearbox, hitch).",
      required: true
    },
    {
      slot: "IDENTIFICATION",
      titleKa: "საიდენტიფიკაციო ფირფიტა / მარკირება",
      titleEn: "Identification Plate / Marking",
      guidanceKa: plateHintKa,
      guidanceEn: plateHintEn,
      required: true
    }
  ];
}

function makeProductTypeDef(input: {
  key: InitialProductTypeKey;
  defaultCategoryKey: TopLevelCategoryKey;
  nameKa: string;
  nameEn: string;
  searchAliasesKa?: string[];
  searchAliasesEn?: string[];
  attributeSchema: ProductTypeAttributeFieldDef[];
}): ProductTypeSeedDef {
  const requiredIdentityFields = [
    "brand",
    "model_code",
    ...input.attributeSchema
      .filter((f) => f.tier === "REQUIRED_IDENTITY")
      .map((f) => f.key)
  ];
  const targetSpecificationFields = input.attributeSchema
    .filter((f) => f.tier !== "REQUIRED_IDENTITY")
    .map((f) => f.key);

  return {
    key: input.key,
    defaultCategoryKey: input.defaultCategoryKey,
    nameKa: input.nameKa,
    nameEn: input.nameEn,
    searchAliasesKa: input.searchAliasesKa ?? [],
    searchAliasesEn: input.searchAliasesEn ?? [],
    namingTemplateKa: "[Brand] [Model] — [Product Type], [Key differentiator]",
    namingTemplateEn: "[Brand] [Model] — [Product Type], [Key differentiator]",
    attributeSchema: input.attributeSchema,
    photoInstructions: buildDefaultPhotoInstructions(input.nameKa, input.nameEn),
    aiResearchContract: {
      requiredIdentityFields,
      targetSpecificationFields,
      forbidInvention: true,
      unknownFieldPolicy: "NULL_NOT_FOUND"
    }
  };
}

/**
 * §5.8 Product Type Matrix v1 — All 30 initial product types.
 */
export const INITIAL_PRODUCT_TYPES: readonly ProductTypeSeedDef[] = [
  makeProductTypeDef({
    key: "MOTOBLOCK",
    defaultCategoryKey: "AGRI_MACHINERY",
    nameKa: "მოტობლოკი",
    nameEn: "Motoblock",
    // §5.10: Public KA term is "მოტობლოკი"; "კულტივატორი" and similar historic terms remain search aliases.
    searchAliasesKa: ["კულტივატორი", "ხელის ტრაქტორი", "მიწის ფრეზი"],
    searchAliasesEn: ["power tiller", "cultivator", "two-wheel tractor"],
    attributeSchema: [
      {
        key: "fuel_type",
        labelKa: "საწვავის ტიპი",
        labelEn: "Fuel Type",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["DIESEL", "GASOLINE", "ELECTRIC"]
      },
      {
        key: "engine_model",
        labelKa: "ძრავის მოდელი",
        labelEn: "Engine Model",
        dataType: "string",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true
      },
      {
        key: "start_type",
        labelKa: "დაქოქვის სისტემა",
        labelEn: "Start System",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["MANUAL_RECOIL", "ELECTRIC_STARTER", "BOTH"]
      },
      {
        key: "transmission_gears",
        labelKa: "გადაცემათა რაოდენობა",
        labelEn: "Transmission Gears",
        dataType: "string",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      },
      {
        key: "wheel_size",
        labelKa: "საბურავის ზომა",
        labelEn: "Wheel Size",
        dataType: "string",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      },
      {
        key: "wheel_type",
        labelKa: "ბორბლის ტიპი",
        labelEn: "Wheel Type",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["RUBBER", "IRON", "BOTH"]
      },
      {
        key: "pto_shaft",
        labelKa: "სიმძლავრის ართმევის ლილვი (PTO)",
        labelEn: "PTO Shaft",
        dataType: "boolean",
        tier: "OPTIONAL_SPEC",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "EARTH_AUGER",
    defaultCategoryKey: "AGRI_MACHINERY",
    nameKa: "მიწის ბურღი",
    nameEn: "Earth Auger",
    searchAliasesKa: ["ორმოს საბურღი", "მოტობურღი"],
    searchAliasesEn: ["post hole digger", "ground auger"],
    attributeSchema: [
      {
        key: "power_source",
        labelKa: "კვების წყარო",
        labelEn: "Power Source",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["GASOLINE_2T", "GASOLINE_4T", "ELECTRIC", "BATTERY", "PTO"]
      },
      {
        key: "max_drill_diameter_mm",
        labelKa: "ბურღის მაქსიმალური დიამეტრი (მმ)",
        labelEn: "Max Drill Diameter (mm)",
        dataType: "number",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        unit: "mm"
      },
      {
        key: "drill_included",
        labelKa: "შედის თუ არა შნეკი კომპლექტში",
        labelEn: "Drill Bit Included",
        dataType: "boolean",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "AGRI_ATTACHMENT",
    defaultCategoryKey: "AGRI_MACHINERY",
    nameKa: "აგრო-მისაბმელი ინვენტარი",
    nameEn: "Agricultural Attachment",
    searchAliasesKa: ["გუთანი", "სათიბელა", "კარტოფილის ამომღები", "სათესი", "ფრეზი"],
    searchAliasesEn: ["plough", "mower attachment", "potato digger", "seeder", "rotary tiller"],
    attributeSchema: [
      {
        key: "attachment_kind",
        labelKa: "ინვენტარის სახეობა",
        labelEn: "Attachment Kind",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: [
          "PLOUGH",
          "ROTARY_MOWER",
          "POTATO_DIGGER",
          "POTATO_PLANTER",
          "SEEDER",
          "RIDGER",
          "CULTIVATOR_BLADE",
          "WATER_PUMP_ATTACHMENT",
          "OTHER"
        ]
      },
      {
        key: "compatible_mount",
        labelKa: "თავსებადი სამაგრი / მოდელი",
        labelEn: "Compatible Mount / Model",
        dataType: "string",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "TRAILER",
    defaultCategoryKey: "AGRI_MACHINERY",
    nameKa: "მისაბმელი (ლაფეტი)",
    nameEn: "Trailer",
    searchAliasesKa: ["მოტობლოკის მისაბმელი", "ლაფეტი"],
    searchAliasesEn: ["motoblock trailer", "cargo trailer"],
    attributeSchema: [
      {
        key: "payload_capacity_kg",
        labelKa: "ტვირთამწეობა (კგ)",
        labelEn: "Payload Capacity (kg)",
        dataType: "number",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        unit: "kg"
      },
      {
        key: "brake_type",
        labelKa: "მუხრუჭის ტიპი",
        labelEn: "Brake Type",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["MECHANICAL_DRUM", "DISC", "HYDRAULIC", "NONE"]
      },
      {
        key: "dumping_bed",
        labelKa: "თვითმცლელი ძარა",
        labelEn: "Tipping / Dumping Bed",
        dataType: "boolean",
        tier: "OPTIONAL_SPEC",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "BRUSHCUTTER",
    defaultCategoryKey: "GARDEN_FORESTRY",
    nameKa: "ბალახის სათიბი (მოტოცელი)",
    nameEn: "Brushcutter",
    searchAliasesKa: ["მოტოცელი", "ტრიმერი", "ბენზოცელი"],
    searchAliasesEn: ["trimmer", "strimmer", "grass cutter"],
    attributeSchema: [
      {
        key: "power_source",
        labelKa: "კვების წყარო",
        labelEn: "Power Source",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["GASOLINE_2T", "GASOLINE_4T", "ELECTRIC", "BATTERY"]
      },
      {
        key: "shaft_type",
        labelKa: "შტანგის ტიპი",
        labelEn: "Shaft Type",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["STRAIGHT_SOLID", "SPLIT", "CURVED"]
      }
    ]
  }),
  makeProductTypeDef({
    key: "LAWN_MOWER",
    defaultCategoryKey: "GARDEN_FORESTRY",
    nameKa: "გაზონის საკრეჭი",
    nameEn: "Lawn Mower",
    searchAliasesKa: ["ბალახის საკრეჭი მანქანა"],
    searchAliasesEn: ["push mower", "self-propelled mower"],
    attributeSchema: [
      {
        key: "power_source",
        labelKa: "კვების წყარო",
        labelEn: "Power Source",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["GASOLINE", "ELECTRIC", "BATTERY", "MANUAL"]
      },
      {
        key: "self_propelled",
        labelKa: "თვითმავალი",
        labelEn: "Self-Propelled",
        dataType: "boolean",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      },
      {
        key: "collector_volume_l",
        labelKa: "ბალახის შემგროვებლის მოცულობა (ლ)",
        labelEn: "Grass Collector Volume (L)",
        dataType: "number",
        tier: "OPTIONAL_SPEC",
        filterCandidate: false,
        unit: "L"
      }
    ]
  }),
  makeProductTypeDef({
    key: "CHAINSAW",
    defaultCategoryKey: "GARDEN_FORESTRY",
    nameKa: "ჯაჭვური ხერხი (ბენზოხერხი)",
    nameEn: "Chainsaw",
    searchAliasesKa: ["ბენზოხერხი", "ელექტრო ხერხი", "დრუჟბა"],
    searchAliasesEn: ["petrol chainsaw", "cordless chainsaw"],
    attributeSchema: [
      {
        key: "power_source",
        labelKa: "კვების წყარო",
        labelEn: "Power Source",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["GASOLINE_2T", "ELECTRIC", "BATTERY"]
      },
      {
        key: "bar_length_cm",
        labelKa: "შინის სიგრძე (სმ)",
        labelEn: "Guide Bar Length (cm)",
        dataType: "number",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        unit: "cm"
      },
      {
        key: "chain_pitch",
        labelKa: "ჯაჭვის ბიჯი",
        labelEn: "Chain Pitch",
        dataType: "string",
        tier: "OPTIONAL_SPEC",
        filterCandidate: false
      }
    ]
  }),
  makeProductTypeDef({
    key: "SHREDDER",
    defaultCategoryKey: "GARDEN_FORESTRY",
    nameKa: "ტოტების დამქუცმაცებელი",
    nameEn: "Garden Shredder / Chipper",
    searchAliasesKa: ["ხის ჩიპერი", "ტოტების საფქვავი"],
    searchAliasesEn: ["wood chipper", "branch shredder"],
    attributeSchema: [
      {
        key: "max_branch_diameter_mm",
        labelKa: "ტოტის მაქსიმალური დიამეტრი (მმ)",
        labelEn: "Max Branch Diameter (mm)",
        dataType: "number",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        unit: "mm"
      },
      {
        key: "power_source",
        labelKa: "კვების წყარო",
        labelEn: "Power Source",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["GASOLINE", "ELECTRIC", "PTO"]
      }
    ]
  }),
  makeProductTypeDef({
    key: "BLOWER",
    defaultCategoryKey: "GARDEN_FORESTRY",
    nameKa: "ფოთლების საბერი",
    nameEn: "Leaf Blower / Vacuum",
    searchAliasesKa: ["ჰაერსაბერი", "ბაღის მტვერსასრუტი"],
    searchAliasesEn: ["leaf blower", "garden blower"],
    attributeSchema: [
      {
        key: "power_source",
        labelKa: "კვების წყარო",
        labelEn: "Power Source",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["GASOLINE", "ELECTRIC", "BATTERY"]
      },
      {
        key: "mounting_style",
        labelKa: "კონსტრუქციის ტიპი",
        labelEn: "Mounting Style",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["HANDHELD", "BACKPACK"]
      }
    ]
  }),
  makeProductTypeDef({
    key: "SPRAYER",
    defaultCategoryKey: "SPRAYING_IRRIGATION",
    nameKa: "შესაწამლი აპარატი",
    nameEn: "Sprayer",
    searchAliasesKa: ["ვენახის შესაწამლი", "ზურგის შემასხურებელი"],
    searchAliasesEn: ["knapsack sprayer", "mist duster", "boom sprayer"],
    attributeSchema: [
      {
        key: "sprayer_type",
        labelKa: "შესაწამლის ტიპი",
        labelEn: "Sprayer Type",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["BATTERY", "MANUAL", "GASOLINE_MIST", "WHEELED_MOTOR", "TRACTOR_MOUNTED"]
      },
      {
        key: "tank_material",
        labelKa: "ავზის მასალა",
        labelEn: "Tank Material",
        dataType: "enum",
        tier: "OPTIONAL_SPEC",
        filterCandidate: true,
        enumValues: ["PLASTIC", "STAINLESS_STEEL", "FIBERGLASS"]
      }
    ]
  }),
  makeProductTypeDef({
    key: "WATER_PUMP",
    defaultCategoryKey: "SPRAYING_IRRIGATION",
    nameKa: "წყლის ტუმბო (პომპა)",
    nameEn: "Water Pump",
    searchAliasesKa: ["მოტოპომპა", "ჭაბურღილის ტუმბო", "სადრენაჟო ტუმბო"],
    searchAliasesEn: ["motor pump", "submersible pump", "centrifugal pump"],
    attributeSchema: [
      {
        key: "pump_category",
        labelKa: "ტუმბოს ტიპი",
        labelEn: "Pump Category",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["SURFACE_MOTOR", "SUBMERSIBLE", "CENTRIFUGAL_ELECTRIC", "PERIPHERAL", "SEWAGE"]
      },
      {
        key: "inlet_outlet_inch",
        labelKa: "შემშვები/გამშვები მილის დიამეტრი (დუიმი)",
        labelEn: "Inlet/Outlet Diameter (inch)",
        dataType: "string",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      },
      {
        key: "max_head_m",
        labelKa: "აწევის მაქსიმალური სიმაღლე (მ)",
        labelEn: "Max Head (m)",
        dataType: "number",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        unit: "m"
      }
    ]
  }),
  makeProductTypeDef({
    key: "IRRIGATION_ACCESSORY",
    defaultCategoryKey: "SPRAYING_IRRIGATION",
    nameKa: "სარწყავი აქსესუარი / შლანგი",
    nameEn: "Irrigation Accessory / Hose",
    searchAliasesKa: ["სარწყავი შლანგი", "სპრინკლერი", "წვეთოვანი მორწყვა"],
    searchAliasesEn: ["hose", "sprinkler", "drip tape", "spray gun"],
    attributeSchema: [
      {
        key: "accessory_type",
        labelKa: "აქსესუარის ტიპი",
        labelEn: "Accessory Type",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["HIGH_PRESSURE_HOSE", "LAYFLAT_HOSE", "SPRAY_GUN", "SPRINKLER", "FITTING"]
      },
      {
        key: "diameter_inch_or_mm",
        labelKa: "დიამეტრი",
        labelEn: "Diameter",
        dataType: "string",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "FEED_MILL",
    defaultCategoryKey: "FARM_EQUIPMENT",
    nameKa: "მარცვლეულის საფქვავი (დრაბილკა)",
    nameEn: "Feed Mill / Grain Crusher",
    searchAliasesKa: ["დრაბილკა", "სიმინდის საფქვავი", "ჩაქუჩიანი წისქვილი"],
    searchAliasesEn: ["grain mill", "hammer mill", "corn crusher"],
    attributeSchema: [
      {
        key: "productivity_kg_h",
        labelKa: "წარმადობა (კგ/სთ)",
        labelEn: "Productivity (kg/h)",
        dataType: "number",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        unit: "kg/h"
      },
      {
        key: "sieve_count",
        labelKa: "საცრების რაოდენობა",
        labelEn: "Sieve Count",
        dataType: "number",
        tier: "OPTIONAL_SPEC",
        filterCandidate: false
      }
    ]
  }),
  makeProductTypeDef({
    key: "MILKING_MACHINE",
    defaultCategoryKey: "FARM_EQUIPMENT",
    nameKa: "საწველი აპარატი",
    nameEn: "Milking Machine",
    searchAliasesKa: ["ძროხის საწველი", "თხის საწველი"],
    searchAliasesEn: ["cow milker", "vacuum milking unit"],
    attributeSchema: [
      {
        key: "animal_type",
        labelKa: "ცხოველის ტიპი",
        labelEn: "Animal Type",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["COW", "GOAT_SHEEP"]
      },
      {
        key: "simultaneous_heads",
        labelKa: "ერთდროულად საწველი სულადობა",
        labelEn: "Simultaneous Heads",
        dataType: "number",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true
      },
      {
        key: "pump_lubrication",
        labelKa: "ვაკუუმ-ტუმბოს ტიპი",
        labelEn: "Vacuum Pump Type",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["DRY", "OIL"]
      }
    ]
  }),
  makeProductTypeDef({
    key: "FARM_PROCESSOR",
    defaultCategoryKey: "FARM_EQUIPMENT",
    nameKa: "სასოფლო გადამამუშავებელი დანადგარი",
    nameEn: "Farm Processor",
    searchAliasesKa: ["ყურძნის საწური", "სიმინდის საფშვნელი", "ინკუბატორი", "სეპარატორი"],
    searchAliasesEn: ["grape crusher", "corn sheller", "incubator", "milk separator"],
    attributeSchema: [
      {
        key: "processor_kind",
        labelKa: "დანადგარის დანიშნულება",
        labelEn: "Processor Kind",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: [
          "GRAPE_CRUSHER",
          "FRUIT_PRESS",
          "CORN_SHELLER",
          "MILK_SEPARATOR",
          "BUTTER_CHURN",
          "INCUBATOR",
          "OTHER"
        ]
      }
    ]
  }),
  makeProductTypeDef({
    key: "POWER_TOOL",
    defaultCategoryKey: "WORKSHOP_CONSTRUCTION",
    nameKa: "ელექტრო ინსტრუმენტი",
    nameEn: "Power Tool",
    searchAliasesKa: ["ბარგალკა", "დრელი", "პერფორატორი", "შურუპოვერტი"],
    searchAliasesEn: ["angle grinder", "drill", "rotary hammer", "impact driver"],
    attributeSchema: [
      {
        key: "tool_kind",
        labelKa: "ინსტრუმენტის ტიპი",
        labelEn: "Tool Kind",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: [
          "ANGLE_GRINDER",
          "DRILL",
          "ROTARY_HAMMER",
          "DEMOLITION_HAMMER",
          "CORDLESS_DRIVER",
          "CIRCULAR_SAW",
          "JIGSAW",
          "HEAT_GUN",
          "OTHER"
        ]
      },
      {
        key: "cordless_battery",
        labelKa: "აკუმულატორული",
        labelEn: "Cordless / Battery",
        dataType: "boolean",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "WELDER",
    defaultCategoryKey: "WORKSHOP_CONSTRUCTION",
    nameKa: "შედუღების აპარატი (სვარკა)",
    nameEn: "Welding Machine",
    searchAliasesKa: ["სვარკა", "ინვერტორული შედუღება", "კემპი"],
    searchAliasesEn: ["inverter welder", "MIG/MAG welder", "MMA welder"],
    attributeSchema: [
      {
        key: "welding_process",
        labelKa: "შედუღების ტიპი",
        labelEn: "Welding Process",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["MMA", "MIG_MAG", "TIG", "MULTI_PROCESS", "PLASMA_CUTTER"]
      },
      {
        key: "max_welding_current_a",
        labelKa: "მაქსიმალური შედუღების დენი (A)",
        labelEn: "Max Welding Current (A)",
        dataType: "number",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        unit: "A"
      }
    ]
  }),
  makeProductTypeDef({
    key: "COMPRESSOR",
    defaultCategoryKey: "WORKSHOP_CONSTRUCTION",
    nameKa: "ჰაერის კომპრესორი",
    nameEn: "Air Compressor",
    searchAliasesKa: ["კომპრესორი"],
    searchAliasesEn: ["piston compressor", "oil-free compressor"],
    attributeSchema: [
      {
        key: "compressor_drive",
        labelKa: "კომპრესორის ტიპი",
        labelEn: "Compressor Drive",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["DIRECT_COAXIAL", "BELT_DRIVE", "OIL_FREE_SILENT", "SCREW"]
      },
      {
        key: "cylinder_count",
        labelKa: "ცილინდრების რაოდენობა",
        labelEn: "Cylinder Count",
        dataType: "number",
        tier: "OPTIONAL_SPEC",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "CONCRETE_MIXER",
    defaultCategoryKey: "WORKSHOP_CONSTRUCTION",
    nameKa: "ბეტონსარევი (მეშალკა)",
    nameEn: "Concrete Mixer",
    searchAliasesKa: ["ბეტონმრევი", "მეშალკა"],
    searchAliasesEn: ["cement mixer"],
    attributeSchema: [
      {
        key: "crown_material",
        labelKa: "გვირგვინის მასალა",
        labelEn: "Ring Gear Material",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["CAST_IRON", "STEEL", "POLYAMIDE"]
      }
    ]
  }),
  makeProductTypeDef({
    key: "JACK",
    defaultCategoryKey: "WORKSHOP_CONSTRUCTION",
    nameKa: "დომკრატი / ამწე",
    nameEn: "Lifting Jack / Hoist",
    searchAliasesKa: ["დომკრატი", "ტალი", "ლებედკა"],
    searchAliasesEn: ["hydraulic jack", "floor jack", "bottle jack", "electric hoist"],
    attributeSchema: [
      {
        key: "lifting_capacity_ton",
        labelKa: "ტვირთამწეობა (ტონა)",
        labelEn: "Lifting Capacity (t)",
        dataType: "number",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        unit: "t"
      },
      {
        key: "jack_mechanism",
        labelKa: "მექანიზმის ტიპი",
        labelEn: "Mechanism Type",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["BOTTLE_HYDRAULIC", "FLOOR_TROLLEY", "MECHANICAL_RACK", "ELECTRIC_HOIST", "CHAIN_BLOCK"]
      }
    ]
  }),
  makeProductTypeDef({
    key: "WHEELBARROW",
    defaultCategoryKey: "WORKSHOP_CONSTRUCTION",
    nameKa: "სამშენებლო/ბაღის ურიკა (ტაჩკა)",
    nameEn: "Wheelbarrow",
    searchAliasesKa: ["ტაჩკა", "ურიკა"],
    searchAliasesEn: ["garden cart", "construction wheelbarrow"],
    attributeSchema: [
      {
        key: "wheel_count",
        labelKa: "ბორბლების რაოდენობა",
        labelEn: "Wheel Count",
        dataType: "number",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "HAND_TOOL",
    defaultCategoryKey: "WORKSHOP_CONSTRUCTION",
    nameKa: "ხელის ინსტრუმენტი / ნაკრები",
    nameEn: "Hand Tool / Tool Set",
    searchAliasesKa: ["ქანჩების ნაკრები", "კლუჩების ნაბორი", "სეკატორი"],
    searchAliasesEn: ["socket set", "wrench set", "pruner"],
    attributeSchema: [
      {
        key: "pieces_count",
        labelKa: "ნაჭრების რაოდენობა ნაკრებში",
        labelEn: "Piece Count",
        dataType: "number",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "ATV",
    defaultCategoryKey: "ATV_TRANSPORT",
    nameKa: "კვადროციკლი",
    nameEn: "ATV / Quad Bike",
    searchAliasesKa: ["კვადრო", "ოთხთვალა"],
    searchAliasesEn: ["quad", "four-wheeler"],
    attributeSchema: [
      {
        key: "power_source",
        labelKa: "ძრავის ტიპი",
        labelEn: "Engine / Power Type",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["GASOLINE_4T", "ELECTRIC"]
      },
      {
        key: "transmission_type",
        labelKa: "გადაცემათა კოლოფი",
        labelEn: "Transmission Type",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["AUTOMATIC_CVT", "SEMI_AUTO", "MANUAL"]
      }
    ]
  }),
  makeProductTypeDef({
    key: "TRICYCLE",
    defaultCategoryKey: "ATV_TRANSPORT",
    nameKa: "სატვირთო ტრიციკლი (მურავეი)",
    nameEn: "Cargo Tricycle",
    searchAliasesKa: ["მურავეი", "სამთვალა მოტოციკლი"],
    searchAliasesEn: ["three-wheeler cargo", "motorized tricycle"],
    attributeSchema: [
      {
        key: "power_source",
        labelKa: "კვების წყარო",
        labelEn: "Power Source",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["GASOLINE_4T", "DIESEL", "ELECTRIC"]
      },
      {
        key: "payload_capacity_kg",
        labelKa: "ტვირთამწეობა (კგ)",
        labelEn: "Payload Capacity (kg)",
        dataType: "number",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        unit: "kg"
      }
    ]
  }),
  makeProductTypeDef({
    key: "TIRE",
    defaultCategoryKey: "TIRES_WHEELS",
    nameKa: "საბურავი",
    nameEn: "Tire",
    searchAliasesKa: ["პაკრიშკა", "მოტობლოკის საბურავი", "ტრაქტორის საბურავი"],
    searchAliasesEn: ["agricultural tire", "tiller tire"],
    attributeSchema: [
      {
        key: "tire_size_code",
        labelKa: "საბურავის ზომის მარკირება",
        labelEn: "Tire Size Marking",
        dataType: "string",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true
      },
      {
        key: "ply_rating",
        labelKa: "შრეების რაოდენობა (PR)",
        labelEn: "Ply Rating (PR)",
        dataType: "string",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      },
      {
        key: "tubeless",
        labelKa: "უკამერო (TL)",
        labelEn: "Tubeless (TL)",
        dataType: "boolean",
        tier: "OPTIONAL_SPEC",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "TUBE",
    defaultCategoryKey: "TIRES_WHEELS",
    nameKa: "საბურავის კამერა",
    nameEn: "Inner Tube",
    searchAliasesKa: ["კამერა"],
    searchAliasesEn: ["tire tube"],
    attributeSchema: [
      {
        key: "tube_size_code",
        labelKa: "კამერის ზომის მარკირება",
        labelEn: "Tube Size Marking",
        dataType: "string",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true
      },
      {
        key: "valve_type",
        labelKa: "ვენტილის (პიპკის) ტიპი",
        labelEn: "Valve Type",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["STRAIGHT_TR13", "BENT_METAL", "OTHER"]
      }
    ]
  }),
  makeProductTypeDef({
    key: "WHEEL_RIM",
    defaultCategoryKey: "TIRES_WHEELS",
    nameKa: "დისკი / აწყობილი ბორბალი",
    nameEn: "Wheel Rim / Complete Wheel",
    searchAliasesKa: ["რკინის ბორბალი", "დისკი"],
    searchAliasesEn: ["iron wheel", "steel rim", "complete tire and wheel"],
    attributeSchema: [
      {
        key: "rim_size_code",
        labelKa: "დისკის/ბორბლის ზომა",
        labelEn: "Rim / Wheel Size",
        dataType: "string",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true
      },
      {
        key: "hub_mount_pattern",
        labelKa: "სამაგრის ნახვრეტები / ღერძის პროფილი",
        labelEn: "Hub Mount / Axle Profile",
        dataType: "string",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true
      }
    ]
  }),
  makeProductTypeDef({
    key: "ENGINE",
    defaultCategoryKey: "SPARE_PARTS_ACCESSORIES",
    nameKa: "ძრავა (ცალკე აგრეგატი)",
    nameEn: "Standalone Engine",
    searchAliasesKa: ["ბენზინის ძრავა", "დიზელის ძრავა", "მატორი"],
    searchAliasesEn: ["diesel engine", "gasoline engine"],
    attributeSchema: [
      {
        key: "fuel_type",
        labelKa: "საწვავის ტიპი",
        labelEn: "Fuel Type",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["DIESEL", "GASOLINE_4T", "GASOLINE_2T"]
      },
      {
        key: "shaft_type",
        labelKa: "ლილვის (ვალის) ტიპი",
        labelEn: "Crankshaft Type",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["KEYWAY", "SPLINE", "TAPERED", "THREADED"]
      },
      {
        key: "shaft_diameter_mm",
        labelKa: "ლილვის დიამეტრი (მმ)",
        labelEn: "Shaft Diameter (mm)",
        dataType: "number",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        unit: "mm"
      }
    ]
  }),
  makeProductTypeDef({
    key: "SPARE_PART",
    defaultCategoryKey: "SPARE_PARTS_ACCESSORIES",
    nameKa: "სათადარიგო ნაწილი",
    nameEn: "Spare Part",
    searchAliasesKa: ["ნაწილი", "კარბურატორი", "დგუში", "რედუქტორი"],
    searchAliasesEn: ["replacement part", "carburetor", "piston", "gearbox part"],
    attributeSchema: [
      {
        key: "compatible_engine_or_machine",
        labelKa: "თავსებადი ძრავა / დანადგარი",
        labelEn: "Compatible Engine / Machine",
        dataType: "string",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true
      },
      {
        key: "part_category",
        labelKa: "ნაწილის კვანძი",
        labelEn: "Part Subsystem",
        dataType: "enum",
        tier: "IMPORTANT_SPEC",
        filterCandidate: true,
        enumValues: ["ENGINE_INTERNAL", "FUEL_SYSTEM", "IGNITION", "TRANSMISSION", "CHASSIS", "ELECTRICAL", "OTHER"]
      }
    ]
  }),
  makeProductTypeDef({
    key: "ACCESSORY",
    defaultCategoryKey: "SPARE_PARTS_ACCESSORIES",
    nameKa: "სახარჯი მასალა / აქსესუარი",
    nameEn: "Consumable / Accessory",
    searchAliasesKa: ["ძუა", "ხერხის ჯაჭვი", "ზეთი", "სათיბის დისკი"],
    searchAliasesEn: ["trimmer line", "saw chain", "cutting blade", "lubricant"],
    attributeSchema: [
      {
        key: "consumable_kind",
        labelKa: "აქსესუარის ტიპი",
        labelEn: "Consumable Kind",
        dataType: "enum",
        tier: "REQUIRED_IDENTITY",
        filterCandidate: true,
        enumValues: ["TRIMMER_LINE", "CUTTING_DISC", "SAW_CHAIN", "GUIDE_BAR", "OIL_LUBRICANT", "PPE", "OTHER"]
      }
    ]
  })
] as const;

export const skuAttributeStatusSchema = z.enum([
  "VERIFIED",
  "UNVERIFIED",
  "NOT_FOUND",
  "CONFLICT"
]);

export const skuAttributeEntrySchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  status: skuAttributeStatusSchema,
  sourceType: z.string().optional(),
  evidenceId: z.string().uuid().optional(),
  verifiedBy: z.string().uuid().optional(),
  verifiedAt: z.string().optional()
});

/**
 * §5.9 Hybrid Attribute Validation:
 * Validates `type_attributes_json` against a Product Type's `attribute_schema_json` definition.
 * Rejects unknown keys (no uncontrolled JSON blobs), verifies value types & enum constraints,
 * and requires `evidenceId` or `verifiedBy` whenever `status === "VERIFIED"`.
 */
export function validateTypeAttributesAgainstSchema(
  schemaDefs: readonly ProductTypeAttributeFieldDef[],
  rawAttributes: Record<string, SkuAttributeValueEntry>,
  options?: { defaultVerifiedByUserId?: string }
): Record<string, SkuAttributeValueEntry> {
  const allowedByKey = new Map(schemaDefs.map((def) => [def.key, def]));
  const validated: Record<string, SkuAttributeValueEntry> = {};

  for (const [key, rawEntry] of Object.entries(rawAttributes)) {
    const def = allowedByKey.get(key);
    if (!def) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Unknown type attribute "${key}". Only fields defined in the Product Type schema are permitted (§5.9).`,
        { field: key, allowedFields: [...allowedByKey.keys()] }
      );
    }

    const parsedEntry = skuAttributeEntrySchema.safeParse(rawEntry);
    if (!parsedEntry.success) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Invalid attribute entry structure for "${key}".`,
        { field: key, issues: parsedEntry.error.issues }
      );
    }

    const { value, status, sourceType, evidenceId, verifiedBy, verifiedAt } = parsedEntry.data;

    if (status === "NOT_FOUND" && value !== null) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Attribute "${key}" has status NOT_FOUND and must have value: null (§6.5).`
      );
    }

    const effectiveVerifiedBy =
      status === "VERIFIED" ? (verifiedBy ?? options?.defaultVerifiedByUserId) : verifiedBy;

    if (status === "VERIFIED" && !evidenceId && !effectiveVerifiedBy) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Attribute "${key}" cannot be marked VERIFIED without an evidenceId or verifiedBy user ID (§5.9, §6.3).`,
        { field: key }
      );
    }

    if (value !== null) {
      if (def.dataType === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Attribute "${key}" expects a finite number.`,
          { field: key, received: value }
        );
      }
      if (def.dataType === "boolean" && typeof value !== "boolean") {
        throw new AppError(
          "VALIDATION_ERROR",
          `Attribute "${key}" expects a boolean.`,
          { field: key, received: value }
        );
      }
      if (def.dataType === "string" && typeof value !== "string") {
        throw new AppError(
          "VALIDATION_ERROR",
          `Attribute "${key}" expects a string.`,
          { field: key, received: value }
        );
      }
      if (def.dataType === "enum") {
        if (typeof value !== "string" || (def.enumValues && !def.enumValues.includes(value))) {
          throw new AppError(
            "VALIDATION_ERROR",
            `Attribute "${key}" must be one of [${(def.enumValues ?? []).join(", ")}].`,
            { field: key, received: value }
          );
        }
      }
    }

    validated[key] = {
      value,
      status,
      ...(sourceType ? { sourceType } : {}),
      ...(evidenceId ? { evidenceId } : {}),
      ...(effectiveVerifiedBy ? { verifiedBy: effectiveVerifiedBy } : {}),
      ...(status === "VERIFIED"
        ? { verifiedAt: verifiedAt ?? new Date().toISOString() }
        : {})
    };
  }

  return validated;
}

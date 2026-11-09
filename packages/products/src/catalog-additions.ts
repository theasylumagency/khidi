import type { ProductTypeAttributeFieldDef as Field,ProductTypePhotoInstructionSlot as Photo } from "@khidi/db";

type Entry=[key:string,ka:string,en:string,required:string[]];
export function subtypeField(key:string,entries:Entry[]):Field {
 return {key,labelKa:"ქვეტიპი",labelEn:"Subtype",dataType:"enum",tier:"REQUIRED_IDENTITY",filterCandidate:true,observable:true,
  enumValues:entries.map(([value])=>value),enumValueMetadata:Object.fromEntries(entries.map(([value,labelKa,labelEn,requiredSpecFields])=>[value,{labelKa,labelEn,requiredSpecFields}]))};
}
function field(key:string,labelKa:string,labelEn:string,dataType:Field["dataType"]="string",unit?:string,enumValues?:string[],required=false):Field {
 return {key,labelKa,labelEn,dataType,tier:required?"REQUIRED_IDENTITY":"IMPORTANT_SPEC",filterCandidate:false,observable:["fuel_type","start_type","material","configuration","side","brush_shape"].includes(key),...(unit?{unit}:{}),...(enumValues?{enumValues}:{})};
}
export const SPARE_PART_FIELDS:Field[]=[
 subtypeField("part_subtype",[
  ["CHAIN","ჯაჭვი","Chain",["chain_pitch","gauge_mm","link_count"]],
  ["GUIDE_BAR","შინა","Guide bar",["bar_length_cm","chain_pitch","gauge_mm"]],
  ["AIR_FILTER","ჰაერის ფილტრი","Air filter",["dimensions","engine_model"]],
  ["SPARK_PLUG","სანთელი","Spark plug",["plug_code","thread_size"]],
  ["BELT","ღვედი","Belt",["belt_profile","belt_length_mm"]],
  ["TILLER_TINE","ფრეზის დანა","Tiller tine",["side","shaft_diameter_mm"]]
 ]),
 field("chain_pitch","ჯაჭვის ნაბიჯი","Chain pitch"),field("gauge_mm","სისქე","Gauge","number","mm"),
 field("link_count","რგოლების რაოდენობა","Link count","number"),field("bar_length_cm","შინის სიგრძე","Bar length","number","cm"),
 field("dimensions","ზომები","Dimensions"),field("engine_model","ძრავის მოდელი","Engine model"),field("plug_code","სანთლის კოდი","Plug code"),
 field("thread_size","ხრახნის ზომა","Thread size"),field("belt_profile","ღვედის პროფილი","Belt profile"),field("belt_length_mm","ღვედის სიგრძე","Belt length","number","mm"),
 field("side","მხარე","Side","enum",undefined,["LEFT","RIGHT"]),field("shaft_diameter_mm","ლილვის დიამეტრი","Shaft diameter","number","mm")
];
const consumable:Field[]=[
 subtypeField("consumable_subtype",[
  ["TRIMMER_LINE","ტრიმერის ძუა","Trimmer line",["diameter_mm","profile","length_m"]],
  ["ABRASIVE_DISC","აბრაზიული დისკი","Abrasive disc",["diameter_mm","thickness_mm","bore_mm","disc_purpose","max_rpm"]],
  ["WIRE_BRUSH","მავთულის ჯაგრისი","Wire brush",["brush_shape","diameter_mm","thread_size","wire_type","max_rpm"]],
  ["WELDING_ELECTRODE","შედუღების ელექტროდი","Welding electrode",["diameter_mm","electrode_grade","pack_weight_kg"]],
  ["OIL","ზეთი","Oil",["oil_type","viscosity","volume_l"]],
  ["GREASE","ცხიმი","Grease",["grease_type","package_amount"]]
 ]),
 field("diameter_mm","დიამეტრი","Diameter","number","mm"),field("profile","პროფილი","Profile"),field("length_m","სიგრძე","Length","number","m"),
 field("thickness_mm","სისქე","Thickness","number","mm"),field("bore_mm","ცენტრის ხვრელი","Centre bore","number","mm"),field("disc_purpose","დანიშნულება","Purpose"),
 field("max_rpm","მაქსიმალური ბრუნი","Maximum speed","number","rpm"),field("brush_shape","ფორმა","Shape","enum",undefined,["CUP","DISC"]),
 field("thread_size","ხრახნი","Thread size"),field("wire_type","მავთულის ტიპი","Wire type"),field("electrode_grade","ელექტროდის მარკა","Electrode grade"),
 field("pack_weight_kg","შეფუთვის წონა","Pack weight","number","kg"),field("oil_type","ზეთის ტიპი","Oil type","enum",undefined,["TWO_STROKE","FOUR_STROKE","CHAIN","HYDRAULIC"]),
 field("viscosity","სიბლანტე","Viscosity"),field("volume_l","მოცულობა","Volume","number","l"),field("grease_type","ცხიმის ტიპი","Grease type"),
 field("package_amount","შეფუთვის მოცულობა ან წონა ერთეულით","Package volume or weight with unit"),field("repeat_purchase","განმეორებითი შეძენა","Repeat purchase","boolean")
];
const generator:Field[]=[
 subtypeField("generator_subtype",[["OPEN_FRAME","ღია ჩარჩო","Open frame",[]],["INVERTER","ინვერტორული","Inverter",[]],["ENCLOSED","დახურული","Enclosed",[]]]),
 field("rated_power_kw","ნომინალური სიმძლავრე","Rated power","number","kW",undefined,true),field("max_power_kw","მაქსიმალური სიმძლავრე","Maximum power","number","kW",undefined,true),
 field("fuel_type","საწვავი","Fuel","enum",undefined,["GASOLINE","DIESEL","GAS"],true),field("phase","ფაზა","Phase","enum",undefined,["1","3"],true),
 field("voltage_v","ძაბვა","Voltage","number","V",undefined,true),field("frequency_hz","სიხშირე","Frequency","number","Hz",undefined,true),
 field("start_type","გაშვების ტიპი","Starting method","enum",undefined,["MANUAL","ELECTRIC","REMOTE"],true),field("engine_model","ძრავის მოდელი (თუ ფირფიტაზეა)","Engine model when stated"),
 field("engine_displacement_cm3","ძრავის მოცულობა","Engine displacement","number","cm3"),field("avr","AVR","AVR","boolean"),field("tank_volume_l","ავზის მოცულობა","Tank volume","number","l"),
 field("sockets","როზეტები: ტიპი და რაოდენობა","Sockets: type and quantity"),field("weight_kg","წონა","Weight","number","kg"),field("power_factor","სიმძლავრის კოეფიციენტი","Power factor","number")
];
const ladder:Field[]=[
 subtypeField("ladder_subtype",[["STEP","დგამი","Step",[]],["EXTENSION","გასაწევი","Extension",[]],["MULTI_PURPOSE","მრავალფუნქციური","Multi-purpose",[]],["SCAFFOLD","ხარაჩო","Scaffold",[]]]),
 field("configuration","სექცია × საფეხური","Sections × steps","string",undefined,undefined,true),field("max_length_m","კიბის მაქსიმალური სიგრძე","Maximum ladder length","number","m",undefined,true),
 field("working_height_m","სამუშაო სიმაღლე","Working height","number","m"),field("max_load_kg","მაქსიმალური დატვირთვა","Maximum load","number","kg",undefined,true),
 field("material","მასალა","Material","enum",undefined,["ALUMINIUM","STEEL","FIBERGLASS"],true),field("standard","სტანდარტი","Standard"),
 field("folded_dimensions","დაკეცილი ზომა","Folded dimensions"),field("weight_kg","წონა","Weight","number","kg")
];
function photos(main:string,secondary:string,identification:string,english:[string,string,string]):Photo[] {return [
 {slot:"MAIN",titleKa:"მთავარი ხედი",titleEn:"Main view",guidanceKa:main,guidanceEn:english[0],required:true},
 {slot:"SECONDARY",titleKa:"დამატებითი ხედები",titleEn:"Additional views",guidanceKa:secondary,guidanceEn:english[1],required:true},
 {slot:"IDENTIFICATION",titleKa:"ეტიკეტი და მარკირება",titleEn:"Label and marking",guidanceKa:identification,guidanceEn:english[2],required:true}
];}
function make(key:string,defaultCategoryKey:"WORKSHOP_CONSTRUCTION"|"SPARE_PARTS_ACCESSORIES",nameKa:string,nameEn:string,attributeSchema:Field[],photoInstructions:Photo[],namingTemplateKa:string,namingTemplateEn:string,rules:string[],repeatPurchase?:boolean) {
 return {key,defaultCategoryKey,nameKa,nameEn,attributeSchema,photoInstructions,namingTemplateKa,namingTemplateEn,searchAliasesKa:[],searchAliasesEn:[],aiResearchContract:{requiredIdentityFields:["brand","model_code",...attributeSchema.filter(f=>f.tier==="REQUIRED_IDENTITY").map(f=>f.key)],targetSpecificationFields:attributeSchema.filter(f=>f.tier!=="REQUIRED_IDENTITY").map(f=>f.key),forbidInvention:true,unknownFieldPolicy:"NULL_NOT_FOUND" as const,rules,...(repeatPurchase?{repeatPurchase:true}:{})}};
}
export const CATALOG_ADDITIONS=[
 make("GENERATOR","WORKSHOP_CONSTRUCTION","გენერატორი","Generator",generator,[...photos("წინა ხედი: გენერატორი მთლიანად.","მართვის პანელი როზეტებით; დამატებით გაშვების მექანიზმი და გვერდითი ხედი.","გენერატორის ფირფიტა ახლო ხედით.",["Full front view of the generator.","Control panel and sockets; also capture the starting mechanism and side view.","Close-up of the generator plate."]),{slot:"ENGINE_IDENTIFICATION",titleKa:"ძრავის ფირფიტა",titleEn:"Engine plate",guidanceKa:"ძრავის ფირფიტა ახლო ხედით. თუ ფირფიტა არ არის, მონიშნეთ „ფირფიტა არ აქვს“.",guidanceEn:"Capture the engine plate or explicitly record its absence.",required:true}],
  "გენერატორი [fuel_type] [Brand] [Model] — [rated_power_kw] კვტ","[Brand] [Model] [fuel_type] Generator, [rated_power_kw] kW",[
   "Store rated and maximum power separately. Ambiguous single power readings are candidates requiring conflict review, never silently assigned to rated power.",
   "Convert kVA to kW only with a power factor explicitly stated by the source.","Starting method requires physical evidence, never a model suffix.",
   "Engine model requires its plate or manufacturer document. Missing plates do not block HOUSE_DEFINED identification.","Omit unknown rated power from the title."
  ]),
 make("LADDER","WORKSHOP_CONSTRUCTION","კიბე და კიბე-ხარაჩო","Ladder",ladder,photos("სრულად გაშლილი კიბე.","დაკეცილი კიბე; საკეტი/სახსარი; მრავალფუნქციურისთვის ყველა გამოყენებადი კონფიგურაცია.","ეტიკეტი დატვირთვითა და სტანდარტით ახლო ხედით.",["Fully unfolded ladder.","Folded ladder, locks/hinges and every usable multi-purpose configuration.","Close-up of the load rating and standard label."]),
  "კიბე-ხარაჩო [material] [configuration] — [max_length_m] მ","[Brand] [material] Multi-purpose Ladder [configuration], [max_length_m] m",[
   "Ladder length and working height are distinct; never infer working height.","Load rating requires label or manufacturer documentation, never a typical value.","Standard requires a visible marking or document."
  ]),
 make("CONSUMABLE","SPARE_PARTS_ACCESSORIES","სახარჯი მასალა","Consumable",consumable,photos("თავად ნივთი მთლიანად.","დისკისა და ჯაგრისის ბრუნისა და ზომების მარკირება ახლო ხედით.","შეფუთვა სპეციფიკაციის ეტიკეტით.",["The complete item.","Close-up of disc/brush speed and dimension markings.","Packaging with its specification label."]),
  "[subtype_name] [key_dimensions]","[subtype_name] [key_dimensions]",[
   "Dimensions require packaging or marking; digits in a legacy name are intake hints only.","Oil type and viscosity require its label; do not invent universal suitability.",
   "Maximum RPM is safety-critical for abrasive discs and wire brushes.","Compatibility/spec-matching is deferred; do not generate fit claims.","Repeat purchase is type metadata, not an invented technical claim."
  ],true)
];

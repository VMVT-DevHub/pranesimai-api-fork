'use strict';

import moleculer from 'moleculer';
import crypto from 'crypto';
import { Action, Method, Service } from 'moleculer-decorators';
import { Survey, SurveyAuthType } from './surveys.service';
import { Page } from './pages.service';
import { AuthRelation, Question, QuestionType } from './questions.service';
import { QuestionOption } from './questionOptions.service';
import DbConnection from '../mixins/database.mixin';

const IS_SEED_REFRESH_ENABLED = process.env.IS_SEED_REFRESH_ENABLED === 'true';
const TEMPLATE_VERSION = 'v1';

type SurveyTemplate = {
  title: Survey['title'];
  description?: Survey['description'];
  icon: Survey['icon'];
  authType: SurveyAuthType;
  spList: Survey['spList'];
  pages: Array<{
    id?: Page['id'];
    title: Page['title'];
    description?: Page['description'];
    dynamicFields?: Array<{
      condition: {
        question: number | string; // virtual id
        value?: Page['dynamicFields'][number]['condition']['value'];
        valueIndex?: number; // index of question option
      };
      values: Page['dynamicFields'][number]['values'];
    }>;
    questions?: Array<{
      id: string; // excel id
      nextQuestion?: string; // excel id
      type: Question['type'];
      title: Question['title'];
      hint?: Question['hint'];
      spField?: Question['spField'];
      description?: Question['description'];
      required: Question['required'];
      riskEvaluation: Question['riskEvaluation'];
      authRelation?: Question['authRelation'];
      condition?: {
        question: number | string; // excel id
        value?: any; // if not present, will be detected automatically
        valueIndex?: number; // index of question option
      }[];
      dynamicFields?: Array<{
        condition: {
          question: number | string; // virtual id
          value?: Question['dynamicFields'][number]['condition']['value'];
          valueIndex?: number; // index of question option
        };
        values: Question['dynamicFields'][number]['values'];
      }>;
      options?: Array<{
        nextQuestion?: string; // excel id
        title: QuestionOption['title'];
        description?: QuestionOption['description'];
      }>;
    }>;
  }>;
};

type SurveyTemplatePage = SurveyTemplate['pages'][number];
type SurveyTemplateQuestion = SurveyTemplatePage['questions'][number];
type QuestionExtends = Partial<SurveyTemplateQuestion>;

const q = (
  type: QuestionType,
  id: number | string,
  nextQuestion: number | string,
  title: Question['title'],
  fields: Partial<SurveyTemplateQuestion> = {},
): SurveyTemplateQuestion => ({
  id: `${id}`,
  nextQuestion: nextQuestion && `${nextQuestion}`,
  type,
  title,
  required: true,
  riskEvaluation: true,
  ...fields,
});

type TypeFactory = (
  id: number | string,
  nextQuestion: number | string,
  title: Question['title'],
  fields?: Partial<SurveyTemplateQuestion>,
) => SurveyTemplateQuestion;

q.input = q.bind(null, QuestionType.INPUT) as TypeFactory;
q.number = q.bind(null, QuestionType.NUMBER) as TypeFactory;
q.date = q.bind(null, QuestionType.DATE) as TypeFactory;
q.datetime = q.bind(null, QuestionType.DATETIME) as TypeFactory;
q.select = q.bind(null, QuestionType.SELECT) as TypeFactory;
q.multiselect = q.bind(null, QuestionType.MULTISELECT) as TypeFactory;
q.radio = q.bind(null, QuestionType.RADIO) as TypeFactory;
q.infocard = q.bind(null, QuestionType.INFOCARD) as TypeFactory;
q.address = q.bind(null, QuestionType.ADDRESS) as TypeFactory;
q.location = q.bind(null, QuestionType.LOCATION) as TypeFactory;
q.text = q.bind(null, QuestionType.TEXT) as TypeFactory;
q.checkbox = q.bind(null, QuestionType.CHECKBOX) as TypeFactory;
q.files = q.bind(null, QuestionType.FILES) as TypeFactory;

// condition
const c = (id: number | string) => [
  {
    question: `${id}`,
  },
];

// dynamicFields multi options
const dm = (question: number | string, indexes: number[], values: any = {}) =>
  indexes.map((valueIndex) => ({
    condition: {
      question,
      valueIndex,
    },
    values,
  }));

// options
const o = (options: string[]) =>
  options.map((title) => ({
    title,
  }));

// single option helper
const os = (title: string, nextQuestion?: number | string, description?: string) => ({
  title,
  nextQuestion: nextQuestion && `${nextQuestion}`,
  description: description && `${description}`,
});

const helperVeiklos = (id: number | string, idOut: number | string, qa: QuestionExtends = {}) => [
  q.radio(id, undefined, 'Nurodykite prekybos būdą', {
    options: [os('Fizinėje prekybos vietoje', `${id}.1`), os('Internetu', `${id}.2`)],
    spField: 'PrekybosBudas',
    ...qa,
  }),
  q.location(`${id}.1`, idOut, 'Žemėlapyje nurodykite pardavimo vietą', {
    condition: c(id),
    spField: 'Koordinates',
    ...qa,
  }),
  q.input(`${id}.2`, idOut, 'Pateikite nuoroda į internetinės prekybos puslapį', {
    condition: c(id),
    spField: 'PapInfo',
    ...qa,
  }),
];

const pages = {
  kontaktiniai: (
    id: number,
    q1: QuestionExtends = {},
    additionalQuestinos: SurveyTemplateQuestion[] = [],
  ) => ({
    title: 'Kontaktiniai duomenys',
    description: 'Patikslinkite savo kontaktinius duomenis',
    questions: [
      q.input(id, id + 1, 'El. pašto adresas', {
        riskEvaluation: false,
        authRelation: AuthRelation.EMAIL,
        spField: 'pran_elpastas',
        ...q1,
      }),
      ...additionalQuestinos,
    ],
  }),

  tema: () => ({
    title: 'Pranešimo tema',
    description: 'Pasirinkite, dėl ko teikiate pranešimą',
  }),

  vieta: () => ({
    title: 'Informacija apie įvykio vietą',
    description: 'Pasirinkite, kurioje vietoje buvo užfiksuotas įvykis',
  }),

  tipas: () => ({
    title: 'Pranešimo tipas',
    description: 'Pasirinkite, dėl ko teikiate pranešimą',
  }),

  detales: () => ({
    title: 'Pranešimo detalės',
    description: 'Pateikite išsamią informaciją',
  }),

  papildoma: () => ({
    title: 'Papildoma informacija',
  }),

  informacija: (
    id: number,
    q1: QuestionExtends = {},
    q2: QuestionExtends = {},
    q3: QuestionExtends = {},
    e: any = {},
  ) => ({
    title: 'Veiklos informacija',
    description: 'Pateikite papildomą informaciją',
    questions: [
      q.location(id, id + 1, '', {
        riskEvaluation: false,
        ...q1,
      }),
      q.input(id + 1, id + 2, 'Nurodykite veiklos pavadinimą', {
        riskEvaluation: false,
        ...q2,
      }),
      q.text(id + 2, id + 3, 'Nurodykite veiklą vykdančius fizinius ar juridinius asmenis', {
        riskEvaluation: false,
        ...q3,
      }),
    ],
    ...e,
  }),

  aplinkybes: (
    id: number,
    q1: QuestionExtends = {},
    additionalQuestinos: SurveyTemplateQuestion[] = [],
  ) => ({
    title: 'Įvykio aplinkybės',
    questions: [
      q.text(
        id,
        id + 1,
        'Pateikite visus jums žinomus faktus ir aplinkybes susijusius su pranešamu įvykiu',
        {
          required: false,
          riskEvaluation: false,
          spField: 'Aplinkybes',
          ...q1,
        },
      ),
      ...additionalQuestinos,
    ],
  }),

  vaizdine: (id: number, q1: QuestionExtends = {}, q2: QuestionExtends = {}) => ({
    title: 'Vaizdinė medžiaga ir kiti dokumentai',
    description:
      'Pridėkite vaizdinę medžiagą (nuotraukas, video) arba kitus dokumentus įrodančius pateikiamus pažeidimus',
    questions: [
      q.radio(id, undefined, 'Ar galite pateikti įrodymų apie pranešamus pažeidimus?', {
        options: [os('Taip', id + 1), os('Ne', 56)],
        spField: 'irodym',
        ...q1,
      }),
      q.files(
        id + 1,
        id + 2,
        'Jei galite pridėkite nuotraukas ar kitus dokumentus kuriuose atsispindėtų pranešami produkto ar patiekalo pažeidimai',
        {
          riskEvaluation: false,
          required: false,
          condition: [
            {
              question: id,
              valueIndex: 0,
            },
          ],
          dynamicFields: [
            ...dm(4, [1], {
              condition: false,
            }),
          ],
          spField: 'files',
          ...q2,
        },
      ),
      q.files(
        id + 2,
        id + 3,
        'Jei galite pridėkite nuotraukas ar kitus dokumentus kuriuose matytusi produkto ar patiekalo ženklinimo informacija',
        {
          riskEvaluation: false,
          required: false,
          condition: [
            {
              question: id,
              valueIndex: 0,
            },
          ],
          dynamicFields: [
            ...dm(4, [2, 4], {
              condition: false,
            }),
          ],
          spField: 'files_zenkl',
          ...q2,
        },
      ),
      q.files(
        id + 3,
        id + 4,
        'Jei galite pridėkite dokumentus įrodančius produkto įsigijimo faktą',
        {
          required: false,
          riskEvaluation: false,
          condition: [
            {
              question: id,
              valueIndex: 0,
            },
          ],
          dynamicFields: [
            ...dm(4, [2, 4], {
              condition: false,
            }),
          ],
          spField: 'files_fakt',
          ...q2,
        },
      ),
      q.files(
        id + 4,
        id + 5,
        'Jei galite pridėkite kitus su pranešamu įvykiu susijusius įrodymus',
        {
          riskEvaluation: false,
          required: false,
          condition: [
            {
              question: id,
              valueIndex: 0,
            },
          ],
          spField: 'files_kiti',
          ...q2,
        },
      ),
    ],
  }),

  teises: (id: number, q1: QuestionExtends = {}, q2: QuestionExtends = {}) => ({
    title: 'Jūsų teisės, pareigos ir atsakomybės',
    description: 'Sutikimas',
    questions: [
      q.checkbox(id, id + 1, 'Patvirtinu kad susipažinau su pranešimų pateikimo VMVT tvarka', q1),
      q.checkbox(
        id + 1,
        undefined,
        'Patvirtinu, kad esu susipažinęs su teisinėmis pasekmėmis už melagingos informacijos teikimą, o mano teikiama informacija yra teisinga.',
        q2,
      ),
    ],
  }),
};

const SURVEYS_SEED: SurveyTemplate[] = [
  // SURVEY 1
  {
    title: 'Maisto srities pranešimų anketa',
    icon: `<svg viewBox="0 0 55 54" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M11.0167 29.4973L24.0442 22.2748C28.2967 19.9123 34.8217 26.2798 32.3917 30.6223L25.1467 43.6948C20.4667 52.1098 2.44418 34.2673 11.0167 29.4973Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M24.292 21.375L22.042 16.2225C21.367 14.58 20.467 13.5 18.667 13.5H10.792C6.94449 13.5 5.16699 14.625 5.16699 19.125C5.35564 23.161 6.94719 27.0046 9.66699 29.9925" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M18.667 13.5C18.667 10.0125 19.207 4.5 14.167 4.5C9.66699 4.5 8.54199 9.3825 8.54199 13.5" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M33.2923 30.375L38.4448 32.625C40.0873 33.3 41.1673 34.2 41.1673 36V43.875C41.1673 47.7225 40.0423 49.5 35.5423 49.5C31.5063 49.3113 27.6627 47.7198 24.6748 45" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M41.167 36.0002C44.6545 36.0002 50.167 35.4602 50.167 40.5002C50.167 45.0002 45.2845 46.1252 41.167 46.1252" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
    spList: 'MSPranesimai',
    description:
      'Pranešimai apie neatitikimus maisto produktų kokybei, saugai, įskaitant maisto produktų, jų tiekėjų ar viešojo maitinimo įstaigų veiklą. Taip pat pranešimai apie nelegalią veiklą, susijusią su maisto produktų gamyba, platinimu ar pardavimu.',
    authType: SurveyAuthType.OPTIONAL,
    pages: [
      // =======================================
      pages.kontaktiniai(3),

      // =======================================
      {
        ...pages.tema(),
        questions: [
          q.infocard(4, undefined, 'Pasirinkite dėl ko pranešate', {
            required: true,
            riskEvaluation: false,
            options: [
              os('Pranešimai apie maisto produktus ar patiekalus', 69, 'MSP1'), // 0
              os('Pranešimai apie sveikatos sutrikdymus', 58, 'MSP2'), // 1
              os(
                'Pranešimai apie maisto tvarkymo veiklos pažeidimus ir/ar nelegaliai vykdomą veiklą',
                69,
                'MSP3',
              ), // 2
              os('Pranešimai apie su maistu besiliečiančias medžiagas', 69, 'MSP4'), // 3
              os('Pranešimai apie viešai tiekiamo geriamojo vandens pažeidimus', 69, 'MSP5'), // 4
            ],
            spField: 'pran_tema',
          }),
        ],
      },
      // =======================================
      {
        ...pages.tipas(),
        dynamicFields: [
          {
            condition: {
              question: 4,
              valueIndex: 0,
            },
            values: {
              title: 'Informacija apie pranešamą įvykį',
            },
          },
        ],
        questions: [
          // --- MSP2
          q.datetime(58, 59, 'Nurodykite produkto ar patiekalo vartojimo datą ir laiką', {
            spField: 'vartoj_data',
            required: true,
            dynamicFields: [
              ...dm(4, [0, 2, 3, 4], {
                condition: false,
              }),
            ],
          }),
          q.datetime(
            59,
            60,
            'Nurodykite datą ir laiką kada pasireiškė pirmieji sveikatos sutrikdymo simptomai',
            {
              spField: 'ivyk_data',
              required: true,
              dynamicFields: [
                ...dm(4, [0, 2, 3, 4], {
                  condition: false,
                }),
              ],
            },
          ),
          q.multiselect(60, 61, 'Nurodykite kokie simptomai pasireiškė', {
            required: true,
            options: o([
              'Pykinimas',
              'Vėmimas',
              'Viduriavimas',
              'Pilvo skausmas arba spazmai',
              'Karščiavimas',
              'Galvos skausmas arba svaigimas',
              'Odos bėrimas ar niežulys ar tinimas',
              'Pasunkėjęs kvėpavimas arba dusulys',
              'Burnos arba dantų arba dantenų sužalojimas',
              'Kiti simptomai (įrašykite)',
            ]),
            spField: 'simptom',
            dynamicFields: [
              ...dm(4, [0, 2, 3, 4], {
                condition: false,
              }),
            ],
          }),
          q.text(61, 62, 'Nurodykite papildomus simptomus kuriee jums pasireiškė', {
            spField: 'simptom_extra',
            required: true,
            dynamicFields: [
              ...dm(4, [0, 2, 3, 4], {
                condition: false,
              }),
            ],
          }),
          q.radio(
            62,
            63,
            'Nurodykite ar dėl atsiradusių sveikatos sutrikdymų kreipėtės į gydymo įstaigą',
            {
              required: true,
              spField: 'ar_kreiptasi',
              riskEvaluation: false,
              options: o(['Taip', 'Ne']),
              dynamicFields: [
                ...dm(4, [0, 2, 3, 4], {
                  condition: false,
                }),
              ],
            },
          ),
          q.select(
            63,
            64,
            'Nurodykite koks kiekis asmenų vartojusių tą patį produktą ar patiekalą pajuto tuos pačius simptomus',
            {
              required: true,
              spField: 'asm_kiekis',
              options: o(['1', '2 - 4', '4 ir  daugiau']),
              dynamicFields: [
                ...dm(4, [0, 2, 3, 4], {
                  condition: false,
                }),
              ],
            },
          ),
          q.text(64, 9, 'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes', {
            spField: 'aplink',
            required: true,
            dynamicFields: [
              ...dm(4, [0, 2, 3, 4], {
                condition: false,
              }),
            ],
          }),

          // --- MSP1, MSP3, MSP4, MSP5

          q.date(69, 66, 'Nurodykite pranešamo įvykio datą', {
            spField: 'ivyk_data',
            required: true,
            dynamicFields: [
              ...dm(4, [1], {
                condition: false,
              }),
            ],
          }),

          q.select(66, 70, 'Nurodykite apie kokio tipo veiklos pažeidimus pranešate', {
            //MSP3
            required: true,
            spField: 'pazeid',
            options: o([
              'Gyvūninio maisto tvarkymo veikla',
              'Ikimokyklinio, mokyklinio ugdymo įstaigų maitinimo veikla (tyrimui visada)',
              'Maisto papildų gamybos veikla',
              'Socialinės globos ir rūpybos įstaigų maitinimo veikla (tiriama visada)',
              'Sveikatos priežiūros įstaigų maitinimo veikla(tiriama visada)',
              'Vaikų stovyklų maitinimo veikla(tiriama visada)',
              'Alkoholinių gėrimų gamybos veikla',
              'Žaliavinio pieno supirkimo punkto, surinkimo centro veikla',
              'Laisvės atėmimo vietų maitinimo veikla',
              'Maisto gamybos namų ūkio virtuvėse veikla',
              'Maisto paslaugų tiekimo veikla (renginiams, kaimo turizmo sodybos ir kt.)',
              'Maisto pristatymo į namus veikla',
              'Maisto produktų gamybos veikla',
              'Gėrimų pardavimo vartoti vietose (barų) veikla',
              'Viešojo maitinimo veikla',
              'Maisto produktų prekybos ir/ar sandėliavimo veikla',
              'Daržovių, vaisių, uogų ir kitų maistui vartojamų augalų auginimo veikla',
              'Internetinės maisto produktų prekybos veikla',
              'Maisto produktų prekybos iš automatų veikla',
              'Kita veikla',
            ]),
            dynamicFields: [
              ...dm(4, [0, 1, 3, 4], {
                condition: false,
              }),
            ],
          }),

          q.multiselect(70, undefined, 'Pasirinkite pranešamus pažeidimus', {
            options: [
              os('Produktas skleidžia nemalonų kvapą ar skonį', 73), // 0
              os('Produktas palieka dėmes, spalvą ar skonį maiste', 73), // 1
              os('Produktas atrodo nesaugus (pvz., plastikas lydosi, danga atsisluoksniuoja)', 73), // 2
              os('Produktas yra sulūžęs, įskilęs ar kitaip pažeistas', 73), // 3
              os('Nėra aiškios informacijos, kad produktas tinkamas naudoti su maistu', 73), // 4
              os(
                'Nenurodyta, kaip saugiai naudoti produktą (pvz., ar galima dėti į orkaitę, mikrobangų krosnelę, plauti indaplovėje)',
                73,
              ), // 5
              os('Produktas atrodo nešvarus, su gamybos ar kitomis priemaišomis', 73), // 6
              os('Informacija apie produktą klaidinanti arba nepilna', 73), // 7
              os('Kiti pažeidimai', 73), // 8

              os('Vanduo turi nemalonų kvapą', 85), // 9
              os('Vanduo turi neįprastą skonį', 85), // 10
              os('Vanduo užterštas (pvz., priemaišos, rūdys, nuosėdos)', 85), // 11
              os('Vanduo gali būti užterštas mikroorganizmais', 85), // 12
              os('Vanduo neatitinka nustatytų cheminių reikalavimų)', 85), // 13
              os(
                'Netinkama ar nesavalaikė vandens tiekimo įmonės reakcija į nustatytas problemas',
                85,
              ), // 14

              os('Prekiaujama pasibaigusio galiojimo produktais', 72), // 15
              os('Maistas yra sugedęs (kvapas, skonis, išvaizda)', 72), // 16
              os('Maiste rastas svetimkūnis (pvz., plaukai, vabzdžiai, stiklas)', 72), // 17
              os('Produktas nebuvo tinkamai termiškai apdorotas (žalias vidus ir pan.)', 72), // 18
              os(
                'Produktas užterštas cheminėmis medžiagomis (skonis, kvapas, įtarimas dėl nuodingumo)',
                72,
              ), // 19
              os('Produkte naudojami neleistini priedai arba klastojama sudėtis', 72), // 20
              os('Nepateikta informacija apie alergenus arba jie nenurodyti aiškiai', 72), // 21
              os('Etiketėje ar pakuotėje trūksta privalomos informacijos', 72), // 22
              os(
                'Informacija apie produktą yra klaidinanti (neteisingi teiginiai ar kilmės duomenys)',
                72,
              ), // 23
              os(
                'Kaina nebuvo nurodyta arba nurodyta neaiškiai (etiketėje, lentynoje ar meniu)',
                72,
              ), // 24
              os('Produktas reklamuojamas klaidinančiai (pvz., žadama nauda sveikatai)', 72), // 25
              os('Maisto papildas nėra notifikuotas', 72), // 26
              os(
                'Pateikta informacija tikėtina neatitinka tikro produkto tipo ar klasės (pvz., sūris ne sūris)',
                72,
              ), // 27
              os('Kiti pažeidimai', 72), // 28

              os('Nenurodoma prekiaujamų maisto produktų ar patiekalų alergenų informacija', 71), // 29
              os(
                'Prekiaujama neleistinais maisto produktais ar produktais su neleistinomis sudėtinėmis dalimis',
                71,
              ), // 30
              os(
                'Produktai užteršti cheminiais, fiziniais, mikrobiniais ar kitokiais teršalais',
                71,
              ), // 31
              os('Veikla vykdoma be leidimų/registracijos', 71), // 32
              os('Veiklos patalpos nehigieniškos, netvarkingos', 71), // 33
              os('Veikloje naudojami produktai su pasibaigusiais tinkamumo vartoti terminais', 71), // 34
              os('Personalas nesilaiko higienos normų', 71), // 35
              os('Veikloje maisto produktai laikomi netinkamomis sąlygomis', 71), // 36
              os('Vykdoma maisto klastojimo veikla', 71), // 37
              os(
                'Veikla vykdoma nesilaikant savikontrolės sistemos, netinkamai tvarkomi privalomi veiklos dokumentai',
                71,
              ), // 38
              os('Vykdomoje veikloje produktai netinkamai ženklinami', 71), // 39
              os('Vykdomoje veikloje netinkamai tvarkomos maisto atliekos', 71), // 40
              os('Vykdomoje viešojo maitinimo veikloje meniu neatitinka reikalavimų', 71), // 41
              os('Patiekalai patiekiami netinkamos temperatūros', 71), // 42
              os('Veiklos reklama pažeidžia teisės aktus', 71), // 43
              os('Nepateikiama privalomoji informacoja apie vykdomą veiklą', 71), // 44
              os('Vykdomoje veikloje daromi kiti pažeidimai', 71), // 45
              os('Kiti pažeidimai', 85), // 46
            ],
            spField: 'paz_tip3',
            dynamicFields: [
              ...dm(4, [0], {
                //1
                options: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28],
              }),
              ...dm(4, [1], {
                //2
                condition: false,
              }),
              ...dm(4, [2], {
                //3
                options: [29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45],
              }),
              ...dm(4, [3], {
                //4
                options: [0, 1, 2, 3, 4, 5, 6, 7, 8],
              }),
              ...dm(4, [4], {
                //5
                options: [9, 10, 11, 12, 13, 14, 46],
              }),
            ],
            required: true,
          }),

          q.text(71, 41, 'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes', {
            riskEvaluation: false,
            required: true,
            spField: 'aplink',
            dynamicFields: [
              //MSP3 DISPLAY
              ...dm(4, [0, 1, 3, 4], {
                condition: false,
              }),
            ],
          }),

          q.text(85, 78, 'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes', {
            riskEvaluation: false,
            required: true,
            spField: 'aplink',
            dynamicFields: [
              //MSP5 DISPLAY
              ...dm(4, [0, 1, 2, 3], {
                condition: false,
              }),
            ],
          }),

          q.text(72, 9, 'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes', {
            riskEvaluation: false,
            required: true,
            spField: 'aplink',
            dynamicFields: [
              //MSP1 DISPLAY
              ...dm(4, [1, 2, 3, 4], {
                condition: false,
              }),
            ],
          }),

          q.text(73, 74, 'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes', {
            riskEvaluation: false,
            required: true,
            spField: 'aplink',
            dynamicFields: [
              //MSP4 DISPLAY
              ...dm(4, [0, 1, 2, 4], {
                condition: false,
              }),
            ],
          }),
        ],
      },

      // =======================================
      {
        ...pages.detales(),
        questions: [
          //MSP1 MSP2
          q.radio(9, undefined, 'Pasirinkite apie ką pranešate.', {
            riskEvaluation: false,
            options: [os('Produktą', 10), os('Patiekalą', 29)],
            spField: 'pran_apie',
            required: true,
          }),
          q.select(10, undefined, 'Pasirinkite apie kokios grupės produktus pranešate', {
            options: [
              os('Mėsa ir jos gaminiai', 11),
              os('Vabzdžių produktai', 12),
              os('Žuvis ir jūros gėrybės', 13),
              os('Pieno produktai ir jų pakaitalai', 14),
              os('Kiaušiniai iš jų produktai', 15),
              os('Grūdai, miltai ir jų gaminiai', 16),
              os('Ankštiniai produktai', 17),
              os('Kanapių produktai', 18),
              os('Daržovės ir jų produktai', 19),
              os('Vaisiai, riešutai ir jų produktai', 20),
              os('Aliejai ir augaliniai riebalai', 21),
              os('Saldumynai ir cukraus produktai', 22),
              os('Medus ir jo produktai', 23),
              os('Gėrimai', 24),
              os('Užkandžiai ir greitas maistas', 25),
              os('Prieskoniai ir pagardai', 26),
              os('Specialios paskirties produktai', 27),
              os('Maisto priedai ir papildai', 28),
            ],
            required: true,
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
            ],
            spField: 'produkt_grup',
          }),
          q.input(29, 41, 'Nurodykite pilną ir tikslų patiekalo pavadinimą', {
            required: true,
            riskEvaluation: false,
            spField: 'patiek_pav',
            condition: [
              {
                question: 9,
                valueIndex: 1,
              },
            ],
          }),
          q.select(11, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Šviežia mėsa (jautiena, kiauliena, paukštiena, aviena ir kt.)', //0
              'Smulkinta mėsa (malta mėsa)', //1
              'Mėsos subproduktai (kepenys, inkstai, širdys, liežuviai ir kt.)', //2
              'Mėsos pusgaminiai (marinuota mėsa, kepsniai, šašlykai, faršas ir kt.)', //3
              'Mėsos gaminiai (dešros, kumpiai, dešrelės, paštetai ir kt.)', //4
              'Mėsos konservai (troškiniai, konservuota mėsa, paštetai ir kt.)', //5
              'Gyvūniniai taukai, spirgai, žarnos, skrandžiai, varlių kojelės, sraigės', //6
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(12, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Svirplių produktai (miltai, baltymų užkandžiai ir kt.)',
              'Kitų vabzdžių produktai (miltai, užkandžiai, baltymai)',
            ]),
            condition: [
              {
                question: 10,
              },
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),
          q.select(13, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Šviežia arba atšaldyta žuvis',
              'Sušaldyta žuvis',
              'Sūdyta, rūkyta arba vytinta žuvis',
              'Jūros gėrybės (vėžiagyviai, moliuskai ir kiti vandens bestuburiai)',
              'Apdorotos jūros gėrybės (sūdyti, rūkyti, virti vėžiagyviai, moliuskai)',
              'Žuvies ir jūros gėrybių kulinariniai gaminiai (užkandžiai, surimi, žuvies kotletai)',
              'Žuvies, vėžiagyvių ir moliuskų konservai',
              'Ikrai',
            ]),
            condition: [
              {
                question: 10,
              },
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),
          q.select(14, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Pienas ir jo gėrimai (karvės, ožkos, avių pienas)',
              'Fermentuoti pieno gaminiai (kefyras, jogurtas, rūgpienis)',
              'Pieno konservai (sterilizuotas, UAT pienas, sutirštintas, sausas pienas)',
              'Varškė ir jos gaminiai (varškė, varškės sūreliai, mišiniai)',
              'Sūriai (fermentiniai, lydyti, tepamieji, pelėsiniai)',
              'Pieno riebalų gaminiai (sviestas, grietinėlė, tepamieji riebalai)',
              'Augaliniai pieno pakaitalai (sojų, avižų, migdolų, kokosų pienas)',
            ]),
            condition: [
              {
                question: 10,
              },
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),
          q.select(15, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Švieži kiaušiniai',
              'Kiaušinių produktai (skysti, milteliniai kiaušiniai)',
            ]),
            condition: [
              {
                question: 10,
              },
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),
          q.select(16, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Javai ir grūdai (ryžiai, kviečiai, avižos, grikiai, miežiai, kukurūzai)',
              'Miltai (kvietiniai, ruginių, grikių, avižiniai, kukurūzų, migdolų)',
              'Duona ir duonos gaminiai (batonas, ruginė duona, bagetės, lavašas)',
              'Kepiniai ir konditerijos gaminiai (bandelės, sausainiai, pyragai, tortai)',
              'Makaronai (švieži, džiovinti, pilno grūdo, be glitimo)',
              'Pusgaminiai iš miltų (blynų, vaflių mišiniai, paruošta tešla kepiniams)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(17, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Pupelės, lęšiai, žirniai, avinžirniai, soja ir jų produktai (džiovinti, konservuoti)',
              'Tofu ir kiti sojos produktai',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(18, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Kanapių sėklos',
              'Kanapių aliejus',
              'Kanapių ekstraktai',
              'Kanapių aliejus',
              'Kanapių baltymai ir miltai',
              'Kanapių užkandžiai (batonėliai, traškučiai ir kt.)',
              'Kiti kanapių produktai (arbata, gėrimai, pastos)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(19, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Šviežios daržovės',
              'Sušaldytos daržovės',
              'Konservuotos ir marinuotos daržovės (agurkai, rauginti kopūstai)',
              'Džiovintos daržovės',
              'Grybai (švieži, atšaldyti, sušaldyti, džiovinti, konservuoti)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(20, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Švieži vaisiai',
              'Sušaldyti vaisiai',
              'Konservuoti vaisiai (kompotai, vaisių tyrės, uogienės, džemai, marmeladai)',
              'Džiovinti vaisiai',
              'Riešutai ir riešutų produktai (riešutų sviestas, džiovinti riešutai, traškučiai)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(21, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Augaliniai aliejai (alyvuogių, saulėgrąžų, rapsų, kokosų)',
              'Augaliniai riebalai (margarinas)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(22, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Cukrus ir jo gaminiai (cukranendrių cukrus, rudasis cukrus, dirbtiniai saldikliai)',
              'Šokoladas ir kakavos gaminiai',
              'Konditerijos gaminiai (šokoladiniai batonėliai, karamelė, saldainiai, zefyrai)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(23, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Medus',
              'Medaus mišiniai (medus su priemaišomis)',
              'Kiti bičių ir medaus produktai',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(24, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Kava ir jos gaminiai',
              'Arbata, matė, žolelių arbatos',
              'Nealkoholiniai gėrimai (sultys, limonadai, vaisvandeniai, gazuotas vanduo',
              'Alkoholiniai gėrimai (alus, vynas, stiprieji gėrimai, sidras)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(25, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Traškučiai, spragėsiai, kukurūzų lazdelės',
              'Greito paruošimo makaronai, sriubos ir košės',
              'Šaldyti pusgaminiai (koldūnai, picos, cepelinai, blynai)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(26, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Druska (joduota, jūros druska, Himalajų druska)',
              'Prieskoniai ir žolelės (bazilikai, cinamonas, pipirai, česnakai, prieskonių mišiniai)',
              'Padažai ir pagardai (kečupas, majonezas, garstyčios, sojų padažas, užtepėlės)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(27, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Kūdikų ir vaikų maistas (pieno mišiniai, tyrelių gaminiai)',
              'Dietiniai produktai (be glitimo, be laktozės, mažai kalorijų turintys produktai)',
              'Funkciniai maisto produktai (baltymų kokteiliai, energiniai batonėliai)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),
          q.select(28, 30, 'Pasirinkite produktą apie kurį pranešate', {
            required: true,
            spField: 'produkt_pogrup',
            riskEvaluation: false,
            options: o([
              'Maisto papildai (vitaminai, mineralai, omega-3, probiotikai)',
              'Maisto fermentai ir jų mišiniai',
              'Maisto priedai (konservantai, dažikliai, kvapiosios medžiagos)',
            ]),
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
              {
                question: 10,
              },
            ],
          }),

          // -----------------

          q.input(30, 31, 'Nurodykite tikslų, pilną produkto pavadinimą.', {
            riskEvaluation: false,
            hint: 'pvz: Vanilinis varškės sūrelis "Karums"',
            spField: 'produkt_pav',
            required: true,
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),

          q.select(31, 32, 'Nurodykite kokia buvo pranešamo produkto pakuotė', {
            required: true,
            riskEvaluation: false,
            spField: 'produkt_pak',
            options: [
              os('Buteliukas'),
              os('Kartoninė dėžutė'),
              os('Vakuuminė dėžutė'),
              os('Skardinė'),
              os('Stiklainis'),
              os('Maišelis'),
              os('Sveriamas produktas maišelyje'),
              os('Be pakuotės'),
            ],
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),

          q.number(32, 33, 'Nurodykite apie kokį produkto kiekį pranešate', {
            riskEvaluation: false,
            spField: 'kiekis',
            required: true,
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),

          q.select(33, 34, 'Pasirinkite nurodyto produkto kiekio matavimo vienetus', {
            riskEvaluation: false,
            spField: 'matas',
            required: true,
            options: [os('Vienetai'), os('Gramai'), os('Kilogramai'), os('Litrai')],
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),

          q.input(34, 35, 'Jei galite nurodykite produkto gamintoją', {
            riskEvaluation: false,
            spField: 'produkt_gam',
            required: false,
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),

          q.input(35, 36, 'Jei galite nurodykite produkto platintoją', {
            riskEvaluation: false,
            spField: 'produkt_plat',
            required: false,
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),

          q.input(36, 37, 'Jei galite nurodykite produkto partijos numerį', {
            riskEvaluation: false,
            spField: 'part_num',
            required: false,
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),
          q.date(37, 41, 'Jei galite nurodykite produkto tinkamumo vartoti terminą', {
            riskEvaluation: false,
            spField: 'vart_term',
            required: false,
            condition: [
              {
                question: 9,
                valueIndex: 0,
              },
            ],
          }),

          // MSP4
          q.input(74, 75, 'Nurodykite tikslų, pilną produkto pavadinimą.', {
            riskEvaluation: false,
            hint: 'pvz: Vanilinis varškės sūrelis "Karums"',
            spField: 'produkt_pav',
            required: true,
            dynamicFields: [
              ...dm(4, [0, 1, 2, 4], {
                condition: false,
              }),
            ],
          }),
          q.input(75, 76, 'Jei galite nurodykite produkto gamintoją', {
            riskEvaluation: false,
            spField: 'produkt_gam',
            required: false,
            dynamicFields: [
              ...dm(4, [0, 1, 2, 4], {
                condition: false,
              }),
            ],
          }),

          q.input(76, 77, 'Jei galite nurodykite produkto platintoją', {
            riskEvaluation: false,
            spField: 'produkt_plat',
            required: false,
            dynamicFields: [
              ...dm(4, [0, 1, 2, 4], {
                condition: false,
              }),
            ],
          }),

          q.input(77, 41, 'Jei galite nurodykite produkto partijos numerį', {
            riskEvaluation: false,
            spField: 'part_num',
            required: false,
            dynamicFields: [
              ...dm(4, [0, 1, 2, 4], {
                condition: false,
              }),
            ],
          }),
        ],
      },
      {
        ...pages.vieta(),
        questions: [
          // MSP1 MSP2 MSP3 MSP4
          q.radio(41, undefined, 'Kur įsigytas produktas ar patiekalas?', {
            riskEvaluation: false,
            required: true,
            spField: 'gavimo_vieta',
            options: [
              os('Fizinėje prekybos vietoje', 42),
              os('Internetu', 47),
              os('Organizuotame renginyje', 84),
            ],
            dynamicFields: [
              ...dm(4, [4], {
                //MSP5
                condition: false,
              }),
              ...dm(4, [0], {
                //MSP1
                options: [0, 1],
              }),
              ...dm(4, [1], {
                //MSP2
                options: [0, 1, 2],
              }),
              ...dm(4, [2], {
                //MSP3
                options: [0, 1],
              }),
              ...dm(4, [3], {
                //MSP4
                options: [0, 1],
              }),
            ],
          }),
          q.address(42, 48, 'Nurodykite veiklos vietos adresą', {
            riskEvaluation: false,
            required: true,
            spField: 'ar_address',
            condition: [
              {
                question: 41,
                valueIndex: 0,
              },
            ],
            dynamicFields: [
              ...dm(4, [4], {
                condition: false,
              }),
            ],
          }),
          // ----
          q.input(47, 48, 'Pateikite prekybos internetinio puslapio nuorodą', {
            riskEvaluation: false,
            required: true,
            spField: 'psl_adresas',
            condition: [
              {
                question: 41,
                valueIndex: 1,
              },
            ],
            dynamicFields: [
              ...dm(4, [4], {
                condition: false,
              }),
            ],
          }),
          // -----
          q.input(84, 51, 'Nurodykite organizuoto renginio pavadinimą', {
            riskEvaluation: false,
            spField: 'org_pav',
            required: true,
            condition: [
              {
                question: 41,
                valueIndex: 2,
              },
            ],
            dynamicFields: [
              ...dm(4, [0, 2, 3, 4], {
                condition: false,
              }),
            ],
          }),
          // -----
          q.input(48, 49, 'Nurodykite produkto ar patiekalo prekybos vietos pavadinimą', {
            spField: 'prekyb_pav',
            required: true,
            riskEvaluation: false,
            dynamicFields: [
              ...dm(4, [4], {
                condition: false,
              }),
            ],
          }),
          q.text(
            49,
            50,
            'Nurodykite visą žinomą papildomą informaciją apie prekybos vietą, nuo darbo valandų iki patekimo į patalpas informacijos',
            {
              spField: 'patek',
              required: false,
              condition: [
                {
                  question: 41,
                  valueIndex: 0,
                },
              ],
              dynamicFields: [
                ...dm(4, [4], {
                  condition: false,
                }),
                {
                  condition: {
                    question: 4,
                    valueIndex: 1,
                  },
                  values: {
                    title:
                      'Nurodykite visą žinomą papildomą informaciją apie prekybos vietą ar organizuotą renginį, nuo darbo valandų iki patekimo į patalpas informacijos',
                  },
                },
              ],
            },
          ),
          q.text(
            50,
            51,
            'Jei galite, nurodykyte fizinius ar juridinius asmenis vykdančius prekybos veiklą',
            {
              spField: 'pap_adr_info',
              required: false,
              dynamicFields: [
                ...dm(4, [4], {
                  condition: false,
                }),
              ],
            },
          ),

          //MSP5

          q.input(78, 79, 'Info iš registrų centro savivaldybė', {
            spField: 'jar_sav',
            riskEvaluation: false,
            required: true,
            dynamicFields: [
              ...dm(4, [0, 1, 2, 3], {
                condition: false,
              }),
            ],
          }),
          q.input(79, 80, 'Info iš registrų centro gyvenvietė', {
            spField: 'jar_gyv',
            riskEvaluation: false,
            required: true,
            dynamicFields: [
              ...dm(4, [0, 1, 2, 3], {
                condition: false,
              }),
            ],
          }),
          q.input(80, 81, 'Info iš registrų centro gatvė', {
            spField: 'jar_gatv',
            riskEvaluation: false,
            required: true,
            dynamicFields: [
              ...dm(4, [0, 1, 2, 3], {
                condition: false,
              }),
            ],
          }),
          q.input(81, 82, 'Info iš registrų centro pastato numeris', {
            spField: 'jar_num',
            riskEvaluation: false,
            required: true,
            dynamicFields: [
              ...dm(4, [0, 1, 2, 3], {
                condition: false,
              }),
            ],
          }),
          q.input(
            82,
            83,
            'Nurodykite kokiu laiku VMVT inspektoriai galėtų atvykti paimti vandens mėginio',
            {
              spField: 'meg_laik',
              riskEvaluation: false,
              required: false,
              dynamicFields: [
                ...dm(4, [0, 1, 2, 3], {
                  condition: false,
                }),
              ],
            },
          ),
          q.text(
            83,
            51,
            'Nurodykite kokiais kontaktais VMVT inspektoriai gali su jumis susisiekti dėl vandens mėginio paėmimo',
            {
              spField: 'kontak',
              riskEvaluation: false,
              required: false,
              dynamicFields: [
                ...dm(4, [0, 1, 2, 3], {
                  condition: false,
                }),
              ],
            },
          ),
        ],
      },

      // =======================================

      {
        ...pages.vaizdine(51),
        description:
          'Pridėkite vaizdinę medžiagą (nuotraukas, video) arba kitus dokumentus įrodančius pateikiamus pažeidimus. Pvz: įsigijimo čekis, produkto nuotraukos, ženklinimo informacija ir pan.',
      },

      // =======================================

      pages.teises(56),
    ],
  },
];

@Service({
  name: 'seed',
  mixins: [DbConnection({ collection: 'seed_metadata', rest: false })],
  settings: {
    fields: {
      id: {
        type: 'number',
        columnType: 'integer',
        primaryKey: true,
      },
      key: {
        type: 'string',
        required: true,
      },
      hash: {
        type: 'string',
        required: true,
      },
      version: {
        type: 'string',
      },
      created_at: {
        type: 'date',
      },
      updated_at: {
        type: 'date',
      },
    },
  },
})
export default class SeedService extends moleculer.Service {
  @Method
  async seedSurveys(surveys: SurveyTemplate[]) {
    for (const surveyItem of surveys) {
      const { pages, ...surveyData } = surveyItem;
      const questionByExcelId: Record<string, Partial<Question<'options'>>> = {};
      let firstPage: Page['id'];

      // 1 - first step: create pages with partial questions
      for (const pageItem of pages) {
        const { questions = [], dynamicFields, ...pageData } = pageItem;
        const page: Page = await this.broker.call('pages.create', pageData);
        pageItem.id = page.id;

        firstPage ||= page.id;

        for (const item of questions) {
          const {
            options,
            id: excelId,
            nextQuestion,
            condition,
            dynamicFields,
            ...questionData
          } = item;

          const question: Question = await this.broker.call('questions.create', {
            ...questionData,
            priority: questions.length - questions.indexOf(item),
            page: page.id,
          });

          questionByExcelId[excelId] = question;
        }
      }

      // 2 - second step: create survey
      const survey: Survey = await this.broker.call('surveys.create', {
        ...surveyData,
        priority: surveys.length - surveys.indexOf(surveyItem),
        firstPage,
      });

      // 3 - third step: update questions missing data and options
      for (const { questions = [], id: pageId, dynamicFields } of pages) {
        if (dynamicFields) {
          await this.broker.call('pages.update', {
            id: pageId,
            dynamicFields: dynamicFields.map((df) => ({
              condition: {
                question: questionByExcelId[df.condition.question].id,
                value:
                  df.condition.value !== undefined
                    ? df.condition.value
                    : questionByExcelId[df.condition.question].options[df.condition.valueIndex].id,
              },
              values: df.values,
            })),
          });
        }

        for (const {
          options = [],
          id: excelId,
          nextQuestion,
          condition,
          dynamicFields,
        } of questions) {
          const qOptions: QuestionOption[] = [];
          for (const optionItem of options) {
            const { nextQuestion, ...optionData } = optionItem;
            if (nextQuestion && !questionByExcelId[nextQuestion]) {
              console.error(nextQuestion, survey, excelId);
            }

            const option: QuestionOption = await this.broker.call('questionOptions.create', {
              ...optionData,
              description: optionData.description,
              question: questionByExcelId[excelId].id,
              priority: options.length - options.indexOf(optionItem),
              nextQuestion:
                nextQuestion && questionByExcelId[nextQuestion]
                  ? questionByExcelId[nextQuestion].id
                  : undefined,
            });

            qOptions.push(option);
          }

          // Debug logging for missing nextQuestion
          if (nextQuestion && !questionByExcelId[nextQuestion]) {
            console.error(
              'Missing nextQuestion in questionByExcelId:',
              nextQuestion,
              'for excelId:',
              excelId,
            );
          }

          // Debug logging for missing dynamicFields condition.question
          if (dynamicFields) {
            dynamicFields.forEach((df) => {
              if (df.condition && !questionByExcelId[df.condition.question]) {
                console.error(
                  'Missing dynamicFields.condition.question in questionByExcelId:',
                  df.condition.question,
                  'for excelId:',
                  excelId,
                );
              }
            });
          }
          const question: Question<'options'> = await this.broker.call('questions.update', {
            id: questionByExcelId[excelId].id,
            survey: survey.id,
            nextQuestion: nextQuestion ? questionByExcelId[nextQuestion].id : undefined,
            condition: condition
              ? condition.map((c) => ({
                  question: questionByExcelId[c.question].id,
                  value:
                    c.value !== undefined
                      ? c.value
                      : c.valueIndex !== undefined
                      ? questionByExcelId[c.question].options[c.valueIndex].id
                      : questionByExcelId[c.question].options.find(
                          (o) => o.nextQuestion === questionByExcelId[excelId].id,
                        ).id,
                }))
              : [],
            dynamicFields: dynamicFields?.map((df) => {
              const values = df.values;

              for (const field in values) {
                if (field === 'options' && values.options && Array.isArray(values.options)) {
                  // @ts-ignore
                  values.options = (values.options as Array<number>).map((option) => {
                    return qOptions[option].id;
                  });
                }
              }

              return {
                condition: {
                  question: questionByExcelId[df.condition.question].id,
                  value:
                    df.condition.value !== undefined
                      ? df.condition.value
                      : questionByExcelId[df.condition.question].options[df.condition.valueIndex]
                          .id,
                },
                values,
              };
            }),
          });

          question.options = qOptions;

          questionByExcelId[excelId] = question;
        }
      }
    }
  }

  @Method
  async shouldRecreateSeedData(currentHash: string): Promise<boolean> {
    return await this.haveSeedTemplatesChanged(currentHash);
  }

  @Method
  async haveSeedTemplatesChanged(currentHash: string): Promise<boolean> {
    const storedHash = await this.getStoredSeedHash();

    if (currentHash != storedHash) {
      return true;
    }

    return false;
  }

  @Method
  generateSeedHash(surveys: SurveyTemplate[]): string {
    const seedString = JSON.stringify(surveys, null, 0);
    return crypto.createHash('md5').update(seedString).digest('hex');
  }

  @Method
  async getStoredSeedHash(): Promise<string | null> {
    try {
      const metadataRecord = (await this.broker.call('seed.findOne', {
        query: { key: 'surveys.seedHash' },
      })) as any;

      return metadataRecord?.hash || null;
    } catch (error) {
      console.warn('Could not retrieve seed hash from database:', error);
      return null;
    }
  }

  @Method
  async storeSeedHash(hash: string): Promise<void> {
    try {
      const existing = (await this.broker.call('seed.findOne', {
        query: { key: 'surveys.seedHash' },
      })) as any;

      if (existing) {
        await this.broker.call('seed.update', {
          id: existing.id,
          hash,
          version: TEMPLATE_VERSION,
          updated_at: new Date(),
        });
      } else {
        await this.broker.call('seed.create', {
          key: 'surveys.seedHash',
          hash,
          version: TEMPLATE_VERSION,
        });
      }
    } catch (error) {
      console.warn('Could not store seed hash in seed_metadata table:', error);
    }
  }

  @Method
  async recreateSeedData(surveys: SurveyTemplate[]) {
    await this.clearAllSeedData();
    await this.seedSurveys(surveys);
  }

  @Method
  async clearAllSeedData() {
    // Cleared in reverese dependency order
    await this.broker.call('questionOptions.removeAllEntities');
    await this.broker.call('questions.removeAllEntities');
    await this.broker.call('pages.removeAllEntities');
    await this.broker.call('surveys.removeAllEntities');
  }

  @Action({ timeout: 180000 })
  async run() {
    await this.broker.waitForServices(['surveys', 'pages', 'questions', 'questionOptions']);

    if (IS_SEED_REFRESH_ENABLED) {
      const currentHash = this.generateSeedHash(SURVEYS_SEED);
      const shouldRecreate = await this.shouldRecreateSeedData(currentHash);

      if (shouldRecreate) {
        await this.recreateSeedData(SURVEYS_SEED);
        await this.storeSeedHash(currentHash);
        console.log('Seed data recreation is completed');
      } else {
        console.log('Seed template is unchanged, no reseeding required');
      }
    } else {
      const count: number = await this.broker.call('surveys.count');

      if (!count) {
        await this.seedSurveys(SURVEYS_SEED);
      }
    }
  }
}

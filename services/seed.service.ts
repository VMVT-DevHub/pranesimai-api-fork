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
        requiresAuth?: QuestionOption['requiresAuth'];
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
const os = (
  title: string,
  nextQuestion?: number | string,
  description?: string,
  requiresAuth?: boolean,
) => ({
  title,
  nextQuestion: nextQuestion && `${nextQuestion}`,
  description: description && `${description}`,
  requiresAuth: requiresAuth && requiresAuth,
});

const helperVeiklos = (id: number | string, idOut: number | string, qa: QuestionExtends = {}) => [
  q.radio(id, undefined, 'Nurodykite prekybos būdą', {
    options: [os('Fizinėje prekybos vietoje', `${id}.1`), os('Internetu', `${id}.2`)],
    spField: 'prekybos_budas',
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
              os(
                'Pranešimai apie maisto produktus ar patiekalus',
                69,
                'Skirta pranešti apie konkrečius maisto produktus ar patiekalus, kai įtariama, kad jie yra galimai nesaugūs, netinkamai laikomi, paruošti ar paženklinti, ir tai gali kelti riziką vartotojų sveikatai.',
              ), // 0
              os(
                'Pranešimai apie sveikatos sutrikdymus',
                58,
                'Skirta pranešti apie sveikatos sutrikimus, siejamus su galimai nesaugaus maisto produkto ar patiekalo vartojimu, kai įtariama, kad sutrikimą lėmė maisto saugos reikalavimų nesilaikymas, o ne individualios organizmo reakcijos ar virusinės ligos.',
              ), // 1
              os(
                'Pranešimai apie maisto tvarkymo veiklos pažeidimus ir/ar nelegaliai vykdomą veiklą',
                69,
                'Skirta pranešti apie maisto tvarkymo subjektų veiklą (pvz., gamyklas, kavines, restoranus, prekybos vietas), kai fiksuojami visos veiklos pažeidimai, tokie kaip higienos reikalavimų nesilaikymas, netinkamas atliekų tvarkymas, patalpų ar įrangos būklė, darbuotojų higiena, taip pat apie nelegaliai vykdomą maisto tvarkymo veiklą.',
              ), // 2
              os(
                'Pranešimai apie su maistu besiliečiančias medžiagas',
                69,
                'Skirta pranešti apie pakuotes, indus, įrankius, gertuvės ar kitus gaminius, skirtus liestis su maistu, kai įtariama, kad jie yra netinkamai paženklinti, neatitinka saugos reikalavimų, turi neleistinų medžiagų, skleidžia neįprastą kvapą, lydosi ar kitaip gali kelti riziką žmonių sveikatai.',
              ), // 3
              os(
                'Pranešimai apie viešai tiekiamo geriamojo vandens pažeidimus',
                69,
                'Skirta pranešti apie viešai tiekiamo geriamojo vandens (šalto vandens) saugos, kokybės ar tiekimo reikalavimų pažeidimus, galinčius kelti grėsmę žmonių sveikatai. Ši anketa taikoma tik centralizuotai tiekiamam geriamajam vandeniui; privatūs šuliniai ar individualūs vandens gręžiniai nepriklauso VMVT kontrolei, taip pat nevertinami karšto vandens tiekimo ar jo kokybės klausimai. Tais atvejais, kai pranešimas susijęs su gyvenamąja vieta, VMVT, siekdama objektyviai nustatyti galimus neatitikimus, atvyksta į vietą ir paima vandens mėginį laboratoriniams tyrimams.',
                true,
              ), // 4
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
            spField: 'veik_tip',
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
            spField: 'prekyb_vieta',
            options: [
              os('Fizinėje prekybos vietoje', 42),
              os('Internetu', 47),
              os('Organizuotame renginyje', 84),
              os('Socialiniais tinklais', 47),
            ],
            dynamicFields: [
              ...dm(4, [4], {
                //MSP5
                condition: false,
              }),
              ...dm(4, [0], {
                //MSP1
                options: [0, 1, 3],
              }),
              ...dm(4, [1], {
                //MSP2
                options: [0, 1, 2, 3],
              }),
              ...dm(4, [2], {
                //MSP3
                options: [0, 1, 3],
              }),
              ...dm(4, [3], {
                //MSP4
                options: [0, 1, 3],
              }),
            ],
          }),
          q.address(42, 48, 'Nurodykite veiklos vietos adresą', {
            riskEvaluation: false,
            required: true,
            spField: 'adresas',
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
              spField: 'veik_asm',
              required: false,
              dynamicFields: [
                ...dm(4, [4], {
                  condition: false,
                }),
              ],
            },
          ),

          //MSP5
          q.address(78, 82, 'Nurodykite veiklos vietos adresą', {
            riskEvaluation: false,
            required: true,
            spField: 'adresas',
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
  // SURVEY 2
  {
    title: 'Veterinarinės srities pranešimai',
    icon: `<svg viewBox="0 0 55 54" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M25.084 13.5C27.5693 13.5 29.584 11.4853 29.584 9C29.584 6.51472 27.5693 4.5 25.084 4.5C22.5987 4.5 20.584 6.51472 20.584 9C20.584 11.4853 22.5987 13.5 25.084 13.5Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M40.834 22.5C43.3193 22.5 45.334 20.4853 45.334 18C45.334 15.5147 43.3193 13.5 40.834 13.5C38.3487 13.5 36.334 15.5147 36.334 18C36.334 20.4853 38.3487 22.5 40.834 22.5Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M45.334 40.5C47.8193 40.5 49.834 38.4853 49.834 36C49.834 33.5147 47.8193 31.5 45.334 31.5C42.8487 31.5 40.834 33.5147 40.834 36C40.834 38.4853 42.8487 40.5 45.334 40.5Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M20.5839 22.5C22.0613 22.5 23.5242 22.791 24.8891 23.3564C26.254 23.9217 27.4942 24.7504 28.5389 25.795C29.5835 26.8397 30.4122 28.0799 30.9776 29.4448C31.5429 30.8097 31.8339 32.2726 31.8339 33.75V41.625C31.8333 43.507 31.1587 45.3266 29.9323 46.7542C28.7058 48.1818 27.0087 49.1229 25.1482 49.4071C23.2878 49.6914 21.3871 49.2999 19.7903 48.3036C18.1936 47.3074 17.0064 45.7723 16.4439 43.9763C15.4839 40.8788 13.4589 38.85 10.3689 37.89C8.57382 37.3278 7.03928 36.1415 6.04297 34.546C5.04666 32.9504 4.65439 31.0509 4.93715 29.1912C5.21992 27.3315 6.15903 25.6345 7.58455 24.4071C9.01007 23.1798 10.8278 22.5033 12.7089 22.5H20.5839Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
    spList: 'MSPranesimai',
    description:
      'Pranešimai apie pašarus ir veterinarinius vaistus, jų kokybės, saugos, ženklinimo ir kitus pažeidimus, nelegalią šių produktų gamybą, tiekimą. Pranešimai apie pašarų ir veterinarinės farmacijos ūkio subjektų veiklos pažeidimus.',

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
              os(
                'Pranešimai apie gyvūnų gerovės pažeidimus',
                5,
                'Pranešimai apie gyvūnų gerovės pažeidimus',
              ), // VSP1
              os(
                'Pranešimai apie gyvūnų augintinių veisimo ar prekybos pažeidimus ir/ar nelegalią veisimo ar prekybos veiklą',
                5,
                'Pranešimai apie gyvūnų augintinių veisimo ar prekybos pažeidimus ir/ar nelegalią veisimo ar prekybos veiklą',
              ), // VSP2
              os(
                'Pranešimai dėl veterinarijos gydyklų veiklos ir/ar gydytojų paslaugų',
                5,
                'Pranešimai dėl veterinarijos gydyklų veiklos ir/ar gydytojų paslaugų',
              ), // VSP3
              os(
                'Pranešimai apie kitos veterinarinės veiklos pažeidimus ir/ar nelegaliai vykdomą veiklą',
                5,
                'Pranešimai apie kitos veterinarinės veiklos pažeidimus ir/ar nelegaliai vykdomą veiklą',
              ), // VSP4
            ],
            spField: 'pran_tema',
          }),
        ],
      },
      {
        ...pages.tipas(),
        questions: [
          q.date(5, 6, 'Nurodykite pranešamo įvykio datą', {
            required: true,
            spField: 'ivyk_data',
          }),
          q.multiselect(6, 7, 'Pasirinkite pranešamus pažeidimus', {
            required: true,
            options: [
              // =========================
              // VSP1
              // =========================
              os('Gyvūno žalojimas, keliantis grėsmę jo gyvybei arba gyvūno nužudymas', '7.5'), // 0
              os(
                'Gyvūno mušimas ar kiti smurtiniai veiksmai, keliantys grėsmę jo sveikatai, bet ne gyvybei',
                '7.5',
              ), // 1
              os('Sąmoningas gyvūno išmetimas ar palikimas be priežiūros (beglobiu)', '7.5'), // 2
              os(
                'Netinkamos laikymo sąlygos (mažas narvas, netinkama aplinka, grandinė ir pan.)',
                '7.5',
              ), // 3
              os('Laikymo sąlygos, keliančios grėsmę gyvūno sveikatai ar gyvybei', '7.5'), // 4
              os('Gyvūnui nesuteikiama būtina veterinarinė pagalba', '7.5'), // 5
              os('Gyvūnui neatlikta privaloma vakcinacija', '7.5'), // 6
              os('Gyvūnas nėra tinkamai paženklintas ar registruotas', '7.5'), // 7
              os('Gyvūnas nepakankamai šeriamas (maisto trūkumas, netinkamas maistas)', '7.5'), // 8
              os('Gyvūnui nesuteikiamas prieinamumas prie švaraus vandens', '7.5'), // 9
              os('Gyvūno keliamas triukšmas', '7.5'), // 10
              os('Kiti pažeidimai', '7.5'), // 11

              // =========================
              // VSP2
              // =========================
              os(
                'Gyvūnai laikomi netinkamomis sąlygomis (purvina, per ankšta, šalta ar karšta, nėra vandens ar pašaro)',
                '7.6',
              ), // 12
              os('Gyvūnai atrodo sergantys, sužaloti ar išsekę', '7.6'), // 13
              os('Gyvūnai parduodami neturint reikiamų dokumentų ar leidimų', '7.6'), // 14
              os(
                'Gyvūnai veisiami ar parduodami nelegaliai (be registracijos, be veterinarinės priežiūros)',
                '7.6',
              ), // 15
              os('Gyvūnai parduodami per jauni (pvz., dar neatjunkę nuo motinos)', '7.6'), // 16
              os(
                'Parduodant pateikiama klaidinanti informacija apie veislę, kilmę ar sveikatos būklę',
                '7.6',
              ), // 17
              os('Gyvūnams naudojami neleistini preparatai, vaistai ar kitos medžiagos', '7.6'), // 18
              os(
                'Gyvūnai laikomi netinkamoje vietoje (pvz., bute, sandėlyje ar automobilyje be leidimo)',
                '7.6',
              ), // 19
              os(
                'Prekyba vykdoma netinkamai (pvz., turgavietėje, socialiniuose tinkluose be registracijos)',
                '7.6',
              ), // 20
              os('Gyvūnai importuojami ar eksportuojami be leidimų ar dokumentų', '7.6'), // 21
              os('Asmuo turi neįprastai daug gyvūnų, galimai vykdo nelegalią veisyklą', '7.6'), // 22
              os('Gyvūnai parduodami be identifikavimo (be mikroschemos, paso)', '7.6'), // 23
              os(
                'Gyvūnų laikymo ar veisimo vietoje skleidžiasi nemalonus kvapas, triukšmas ar kyla įtarimų dėl nepriežiūros',
                '7.6',
              ), // 24
              os('Kiti pažeidimai', '7.6'), // 25

              // =========================
              // VSP3
              // =========================
              os('Veterinarijos gydykla veikia be leidimo ar neregistruota', 7), // 26
              os('Gydykloje nesilaikoma švaros ar higienos reikalavimų', 7), // 27
              os('Gyvūnai gydomi netinkamomis ar nesaugomis sąlygomis', 7), // 28
              os('Gydykloje laikomi gyvūnai atrodo sužaloti, neprižiūrėti ar kenčiantys', 7), // 29
              os('Naudojami neaiškios kilmės ar galimai pasibaigusio galiojimo vaistai', 7), // 30
              os('Veterinarijos gydytojas elgiasi netinkamai ar žiauriai su gyvūnu', 7), // 31
              os('Gyvūnui suteikta paslauga pakenkė jo sveikatai', 7), // 32
              os('Gyvūnas nugaišo galimai dėl netinkamo gydymo ar priežiūros', 7), // 33
              os('Nepateikiama informacija apie teikiamas paslaugas ar kainas', 7), // 34
              os('Gyvūno savininkui nesuteikiama informacija apie diagnozę ar gydymą', 7), // 35
              os('Gydymo metu paimti ar laikomi gyvūnai negrąžinami savininkui', 7), // 36
              os('Įtarimas, kad gydykla verčiasi nelegalia prekyba vaistais ar gyvūnais', 7), // 37
              os(
                'Įtarimas, kad gydykla atlieka veiklą, kurios neturi teisės vykdyti (pvz., veisia ar prekiauja gyvūnais)',
                7,
              ), // 38
              os(
                'Skundas dėl veterinarijos gydytojo neprofesionalaus, nemandagaus ar neetiško elgesio',
                7,
              ), // 39
              os('Kiti pažeidimai', 7), // 40

              // =========================
              // VSP4
              // =========================
              os('Veikla vykdoma be leidimo ar registracijos', 7), // 41
              os(
                'Veikla vykdoma ne toje vietoje ar ne tokiomis sąlygomis, kokioms suteiktas leidimas',
                7,
              ), // 42
              os('Skerdimas atliekamas neturint teisės ar be veterinarinės priežiūros', 7), // 43
              os(
                'Gyvūnai transportuojami netinkamomis sąlygomis (be leidimo, be dokumentų, per ilgas transportavimas, netinkama transporto priemonė)',
                7,
              ), // 44
              os(
                'Gyvūnų surinkimo, laikymo ar gaišenų tvarkymo vietos neatitinka reikalavimų (duobės, aikštelės, konteineriai ir pan.)',
                7,
              ), // 45
              os(
                'Atliekama veikla, kuri gali užteršti aplinką ar kelti pavojų žmonių ar gyvūnų sveikatai (pvz., gaišenų, atliekų netinkamas tvarkymas)',
                7,
              ), // 46
              os(
                'Atliekama dezinfekcija, dezinsekcija ar deratizacija neturint leidimo arba naudojant neleistinas medžiagas',
                7,
              ), // 47
              os(
                'Medžioklės metu nesilaikoma veterinarinių reikalavimų (pvz., netinkamai apdorojamas ar tvarkomas sumedžiotas gyvūnas)',
                7,
              ), // 48
              os(
                'Skerdenos, kraujas ar kitos gyvūninės kilmės atliekos tvarkomos netinkamai ar neleistinose vietose',
                7,
              ), // 49
              os(
                'Atliekama veikla, kuri gali platinti ligas (pvz., gyvūnai judinami iš karantino teritorijos be leidimo)',
                7,
              ), // 50
              os(
                'Veikla vykdoma be tinkamos įrangos ar neatitinkančiose higienos reikalavimų patalpose',
                7,
              ), // 51
              os(
                'Neteikiami ar suklastoti duomenys VMVT ar kitoms institucijoms apie vykdomą veiklą',
                7,
              ), // 52
              os('Kiti pažeidimai', 7), // 53
            ],
            spField: 'paz_tip3',
            dynamicFields: [
              // VSP1
              ...dm(4, [0], {
                options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
              }),

              // VSP2
              ...dm(4, [1], {
                options: [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
              }),

              // VSP3
              ...dm(4, [2], {
                options: [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
              }),

              // VSP4
              ...dm(4, [3], {
                options: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53],
              }),
            ],
          }),
          q.text(7, 8, 'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes', {
            required: true,
            spField: 'aplink',
            dynamicFields: [
              ...dm(4, [0, 1], {
                condition: false,
              }),
            ],
          }), //VKS3, VKS4
          q.text('7.5', 9, 'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes', {
            required: true,
            spField: 'aplink',
            dynamicFields: [
              ...dm(4, [1, 2, 3], {
                condition: false,
              }),
            ],
          }), //VKS1
          q.text(
            '7.6',
            10,
            'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes',
            {
              required: true,
              spField: 'aplink',
              dynamicFields: [
                ...dm(4, [0, 2, 3], {
                  condition: false,
                }),
              ],
            },
          ), //VKS2
          q.select(
            8,
            undefined,
            'Nurodykite apie kokį veterinarinės praktikos veiklos tipą pranešate',
            {
              required: true,
              spField: 'veik_tip',
              options: [
                // VSP3
                os('Veterinarijos gydykla / klinika (įmonė)', 19),
                os('Veterinarijos kabinetas (įmonė)', 19),
                os('Privatus veterinarijos gydytojas', 19),
                os('Mobilus veterinarijos gydytojas (paslaugos pagal iškvietimą)', 19),
                os('Veterinarijos paramedikas', 19),
                os('Kita veterinarinės praktikos veikla', 19),

                // VSP4
                os('Gyvūnų veisimas, laikymas, prekyba ir priežiūra.', 22),
                os('Gyvūnų prieglaudų, globos įstaigų, viešbučių, dresūros mokyklų veikla.', 22),
                os('Gyvūnų surinkimo, karantino ir laikymo vietų veikla.', 22),
                os('Gyvūnų vežėjų veikla (1 tipo ir 2 tipo leidimai).', 22),
                os('Veterinarinės praktikos veikla (veterinarijos gydytojų ir įmonių).', 22),
                os(
                  'Gyvūninių šalutinių produktų surinkimas, laikymas, perdirbimas, kompostavimas, deginimas.',
                  22,
                ),
                os('Akvakultūros ir žuvininkystės ūkių veikla (veisimas, auginimas, prekyba).', 22),
                os('Gaišenų surinkimo ir laikymo aikštelių veikla.', 22),
                os('Gyvūnų karantino ir izoliavimo vietų veikla.', 22),
                os('Mobilių skerdyklų veikla.', 22),
                os('Laukinių gyvūnų apdorojimo vietų (medžiotojų punktų) veikla.', 22),
              ],
              dynamicFields: [
                ...dm(4, [0, 1], {
                  condition: false,
                }),
                ...dm(4, [2], {
                  options: [0, 1, 2, 3, 4, 5],
                }),
                ...dm(4, [3], {
                  options: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
                }),
              ],
            },
          ),
        ],
      },
      {
        ...pages.detales(),
        questions: [
          q.multiselect(9, 10, 'Nurodykite apie kokio tipo gyvūnus pranešate', {
            required: true,
            spField: 'gyv_tip',
            options: [
              os('Gyvūnas augintinis', '9.1'),
              os('Ūkinis gyvūnas', '9.2'),
              os('Laukinis gyvūnas', '9.3'),
            ],
            dynamicFields: [
              ...dm(4, [1, 2, 3], {
                condition: false,
              }),
            ],
          }),
          q.multiselect(
            '9.1',
            undefined,
            'Pasirinkite apie kokios rūšies gyvūną ar gyvūnus pranešate',
            {
              required: true,
              options: [os('Šuo', 12), os('Katė', 12), os('Šeškas', 12), os('Kita', '9.1.1')],
              condition: c(9),
            },
          ),
          q.input(
            '9.1.1',
            12,
            'Nurodykite gyvūnų apie kuriuos pranešate pavadinimus jei jų pasirenkamame saraše nebuvo',
            {
              required: true,
              spField: 'gyv_pav',
              condition: [
                {
                  question: 9,
                  valueIndex: 0,
                },
                {
                  question: '9.1',
                  valueIndex: 3,
                },
              ],
            },
          ),
          q.multiselect(
            '9.2',
            undefined,
            'Pasirinkite apie kokios rūšies gyvūną ar gyvūnus pranešate',
            {
              required: true,
              options: [
                os('Galvijas', 12),
                os('Ožka', 12),
                os('Kiaulė', 12),
                os('Pauštis', 12),
                os('Arklys', 12),
                os('Kita', '9.2.1'),
              ],
              condition: c(9),
            },
          ),
          q.input(
            '9.2.1',
            12,
            'Nurodykite gyvūnų apie kuriuos pranešate pavadinimus jei jų pasirenkamame saraše nebuvo',
            {
              required: true,
              spField: 'gyv_pav',
              condition: [
                {
                  question: 9,
                  valueIndex: 1,
                },
                {
                  question: '9.2',
                  valueIndex: 5,
                },
              ],
            },
          ),
          q.multiselect(
            '9.3',
            undefined,
            'Pasirinkite apie kokios rūšies gyvūną ar gyvūnus pranešate',
            {
              required: true,
              options: [
                os('Šernas', 12),
                os('Stirna', 12),
                os('Paukštis', 12),
                os('Briedis', 12),
                os('Lapė', 12),
                os('Kita', '9.3.1'),
              ],
              condition: c(9),
            },
          ),
          q.input(
            '9.3.1',
            12,
            'Nurodykite gyvūnų apie kuriuos pranešate pavadinimus jei jų pasirenkamame saraše nebuvo',
            {
              required: true,
              spField: 'gyv_pav',
              condition: [
                {
                  question: 9,
                  valueIndex: 2,
                },
                {
                  question: '9.3',
                  valueIndex: 5,
                },
              ],
            },
          ),
          q.multiselect(
            10,
            undefined,
            'Pasirinkite apie kokios rūšies gyvūną ar gyvūnus pranešate',
            {
              required: true,
              spField: 'gyv_rus',
              options: [os('Šuo', 12), os('Katė', 12), os('Šeškas', 12), os('Kita', 11)],
              dynamicFields: [
                ...dm(4, [0, 2, 3], {
                  condition: false,
                }),
                ...dm(4, [1], {
                  options: [0, 1, 2, 3],
                }),
              ],
            },
          ),
          q.input(
            11,
            12,
            'Nurodykite gyvūnų apie kuriuos pranešate pavadinimus jei jų pasirenkamame saraše nebuvo',
            {
              required: true,
              condition: c(10),
              spField: 'gyv_rus_kita',
            },
          ),
        ],
        dynamicFields: [
          ...dm(4, [2, 3], {
            condition: false,
          }),
        ],
      },
      {
        ...pages.vieta(),
        questions: [
          // ==== VSP1 VSP2 ====
          q.radio(12, undefined, 'Nurodykite kur pastebėjote pranešamus pažeidimus', {
            options: [
              os('Fizinė gyvūnų laikymo vieta', 13),
              os('Internetinė erdvė', 16),
              os('Socialiniai tinklai', 34),
            ],
            required: true,
            spField: 'prekyb_vieta',
          }),
          q.radio(13, undefined, 'Ar galite nurodyti tikslų gyvūno laikymo vietos adresą?', {
            options: [os('Taip', 14), os('Ne', 15)],
            required: true,
            condition: [
              {
                question: 12,
                valueIndex: 0,
              },
            ],
          }),
          q.address(14, 15, 'Nurodykite tikslų gyvūnų laikymo vietos adresą', {
            required: true,
            spField: 'adresas',
            condition: [
              {
                question: 12,
                valueIndex: 0,
              },
              {
                question: 13,
                valueIndex: 0,
              },
            ],
          }),
          q.input(15, 17, 'Nurodykite gyvūnų laikymo vietos koordinates', {
            spField: 'koord',
            required: true,
            condition: [
              {
                question: 12,
                valueIndex: 0,
              },
              {
                question: 13,
                valueIndex: 1,
              },
            ],
          }),
          q.input(34, 17, 'Nurodykite socialinių tinklų nuorodą', {
            required: true,
            spField: 'psl_adresas',
            condition: [
              {
                question: 12,
                valueIndex: 2,
              },
            ],
          }),
          q.input(16, 17, 'Nurodykite internetinio puslapio kuriame pastebėti pažeidimai nuorodą', {
            required: true,
            spField: 'psl_adresas',
            condition: [
              {
                question: 12,
                valueIndex: 1,
              },
            ],
          }),
          q.input(17, 18, 'Nurodykite visą žinomą informaciją apie gyvūno laikytojus', {
            spField: 'pap_adr_info',
            required: true,
          }),
          q.text(
            18,
            29,
            'Nurodykite  visą žinomą papildomą informaciją apie įvykio vietą, nuo darbo valandų iki patekimo į patalpas informacijos ar bet kokią kitą informaciją padedančią mums surasti pranešamus pažeidimus',
            {
              required: false,
              spField: 'patek',
            },
          ),
        ],
        dynamicFields: [
          ...dm(4, [2, 3], {
            condition: false,
          }),
        ],
      },
      // ==== VSP3 ====
      {
        ...pages.vieta(),
        questions: [
          q.address(19, 20, 'Nurodykite adresą kuriuo vykdoma veterinarijos praktikos veikla', {
            required: true,
            spField: 'adresas',
          }),
          q.input(
            20,
            21,
            'Nurodykite pranešamo veterinarijos gydytojo vardą ir pavardę ar veterinarijos praktikos vykdymo vietos pavadinimą',
            {
              required: true,
              spField: 'pap_adr_info',
            },
          ),
          q.text(
            21,
            29,
            'Nurodykite  visą žinomą papildomą informaciją apie įvykio vietą, nuo darbo valandų iki patekimo į patalpas informacijos ar bet kokią kitą informaciją padedančią mums surasti pranešamus pažeidimus',
            {
              required: false,
              spField: 'patek',
            },
          ),
        ],
        dynamicFields: [
          ...dm(4, [0, 1, 3], {
            condition: false,
          }),
        ],
      },
      // ==== VSP4 ====
      {
        ...pages.vieta(),
        questions: [
          q.radio(22, undefined, 'Ar galite nurodyti tikslų veiklos vykdymo vietos adresą?', {
            options: [os('Taip', 23), os('Ne', 24)],
            required: true,
          }),
          q.address(23, 25, 'Nurodykite adresą kuriuo vykdoma veterinarijos praktikos veikla', {
            spField: 'adresas',
            required: true,
            condition: [
              {
                question: 22,
                valueIndex: 0,
              },
            ],
          }),
          q.input(24, 25, 'Nurodykite veiklos vykdymo vietos koordinates', {
            spField: 'koord',
            required: true,
            condition: [
              {
                question: 22,
                valueIndex: 1,
              },
            ],
          }),
          q.input(
            25,
            26,
            'Jei pranešami pažeidimai vykdomi su transporto priemone nurodykite jos valstybinius numerius',
            {
              spField: 'pap_info',
              required: false,
            },
          ),
          q.input(26, 27, 'Nurodykite veiklos vietos pavadinimą', {
            spField: 'veik_pav',
            required: false,
          }),
          q.text(27, 28, 'Nurodykite veiklą vykdančių fizinius ar juridinius asmenis', {
            spField: 'veik_asm',
            required: false,
          }),
          q.text(
            28,
            29,
            'Nurodykite  visą žinomą papildomą informaciją apie įvykio vietą, nuo darbo valandų iki patekimo į patalpas informacijos ar bet kokią kitą informaciją padedančią mums surasti pranešamus pažeidimus',
            {
              spField: 'patek',
              required: false,
            },
          ),
        ],
        dynamicFields: [
          ...dm(4, [0, 1, 2], {
            condition: false,
          }),
        ],
      },

      // == dokumentai ==
      {
        title: 'Vaizdinė medžiaga ir kiti dokumentai',
        description:
          'Pridėkite vaizdinę medžiagą (nuotraukas, video) arba kitus dokumentus įrodančius pateikiamus pažeidimus',
        questions: [
          q.files(
            29,
            30,
            'Jei galite pridėkite nuotraukas ar kitus dokumentus kuriuose atsispindėtu pranešami pažeidimai',
            {
              required: false,
              spField: 'files',
            },
          ),
          q.files(30, 31, 'Jei galite pridėkite kitus su pranešamu įvykiu susijusius įrodymus', {
            required: false,
            spField: 'files_kiti',
          }),
        ],
      },

      pages.teises(31),

      // =======================================
    ],
  },
  // SURVEY 3
  {
    title: 'Veterinarinių vaistų ir pašarų pranešimai',
    icon: `<svg viewBox="0 0 55 54" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M23.6253 46.1248L46.1253 23.6248C47.1766 22.5944 48.0133 21.3659 48.5869 20.0102C49.1605 18.6545 49.4597 17.1985 49.4672 15.7265C49.4746 14.2544 49.1901 12.7955 48.6302 11.4341C48.0703 10.0726 47.2461 8.83572 46.2052 7.79481C45.1643 6.75391 43.9274 5.92967 42.5659 5.36978C41.2045 4.80988 39.7456 4.52542 38.2736 4.53286C36.8015 4.54029 35.3455 4.83947 33.9898 5.41309C32.6341 5.98671 31.4056 6.8234 30.3753 7.87476L7.87525 30.3748C6.82389 31.4051 5.9872 32.6336 5.41358 33.9893C4.83996 35.345 4.54078 36.801 4.53335 38.2731C4.52591 39.7451 4.81037 41.204 5.37026 42.5655C5.93016 43.9269 6.75439 45.1638 7.7953 46.2047C8.83621 47.2456 10.0731 48.0699 11.4346 48.6298C12.796 49.1897 14.2549 49.4741 15.727 49.4667C17.199 49.4592 18.655 49.1601 20.0107 48.5864C21.3664 48.0128 22.5949 47.1761 23.6253 46.1248Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M19.125 19.125L34.875 34.875" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
    `,
    spList: 'MSPranesimai',
    description:
      'Pranešimai apie pašarus ir veterinarinius vaistus, jų kokybės, saugos, ženklinimo ir kitus pažeidimus, nelegalią šių produktų gamybą, tiekimą. Pranešimai apie pašarų ir veterinarinės farmacijos ūkio subjektų veiklos pažeidimus.',
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
              os(
                'Pranešimai apie veterinarinių vaistų ar pašarų pažeidimus',
                '5.5',
                'Pranešimai apie veterinarinių vaistų ar pašarų pažeidimus (VVP1)',
              ), // VVP1
              os(
                'Pranešimai apie veterinarinių vaistų ar pašarų veiklos pažeidimus',
                5,
                'Pranešimai apie veterinarinių vaistų ar pašarų veiklos pažeidimus (VVP2)',
              ), // VVP2
            ],
            spField: 'pran_tema',
          }),
        ],
      },
      {
        ...pages.tipas(),
        questions: [
          q.date(5, 6, 'Nurodykite pranešamo įvykio datą', {
            required: true,
            spField: 'ivyk_data',
          }),
          q.date('5.5', 8, 'Nurodykite pranešamo įvykio datą', {
            required: true,
            spField: 'ivyk_data',
          }),
          q.multiselect(6, 7, 'Nurodykite apie kokio tipo veiklos pažeidimus pranešate', {
            required: true,
            options: o([
              'Veterinarinių vaistų gamyba',
              'Veterinarinių vaistų didmeninis platinimas',
              'Veterinarinių vaistų mažmeninė prekyba ne vaistinėse',
              'Veterinarinių vaistų prekyba internetu',
              'Pašarų gamyba',
              'Pašarinių priedų gamyba',
              'Pašarų didmeninė prekyba',
              'Pašarų mažmeninė prekyba',
              'Pašarų importas',
              'Pašarų eksportas',
              'Pašarų sandėliavimas',
              'Pašarų transportavimas',
              'Pašarų maišymas ūkiuose',
              'Pašarų teikimas rinkai internetu',
            ]),
            spField: 'veik_tip',
            dynamicFields: [
              ...dm(4, [0], {
                condition: false,
              }),
            ],
          }),
          q.multiselect(7, 9, 'Pasirinkite pranešamus pažeidimus', {
            required: true,
            options: o([
              'Nenurodoma prekiaujamų produktų informacija',
              'Prekiaujama neleistinais produktais ar produktais su neleistinomis sudėtinėmis dalimis',
              'Produktai užteršti cheminiais, fiziniais, mikrobiniais ar kitokiais teršalais',
              'Veikla vykdoma be leidimų/registracijos',
              'Veiklos patalpos nehigieniškos, netvarkingos',
              'Veikloje naudojami produktai su pasibaigusiais tinkamumo vartoti terminais',
              'Personalas nesilaiko higienos normų',
              'Veikloje maisto produktai laikomi netinkamomis sąlygomis',
              'Vykdoma maisto klastojimo veikla',
              'Veikla vykdoma nesilaikant savikontrolės sistemos, netinkamai tvarkomi privalomi veiklos dokumentai',
              'Vykdomoje veikloje produktai netinkamai ženklinami',
              'Vykdomoje veikloje netinkamai tvarkomos maisto atliekos',
              'Vykdomoje viešojo maitinimo veikloje meniu neatitinka reikalavimų',
              'Patiekalai patiekiami netinkamos temperatūros',
              'Veiklos reklama pažeidžia teisės aktus',
              'Nepateikiama privalomoji informacoja apie vykdomą veiklą',
              'Vykdomoje veikloje daromi kiti pažeidimai',
            ]),
            spField: 'paz_tip3',
            dynamicFields: [
              ...dm(4, [0], {
                condition: false,
              }),
            ],
          }),
          q.multiselect(8, '9.5', 'Pasirinkite pranešamus pažeidimus', {
            required: true,
            options: o([
              'Produktu prekiaujama be leidimo ar neleistinoje vietoje',
              'Produktas parduodamas ar naudojamas be reikiamų dokumentų',
              'Produktas pasibaigusio galiojimo',
              'Produktas laikomas netinkamomis sąlygomis (per karšta, šalta, drėgna, nešvaru)',
              'Produktas ženklinamas netinkamai arba klaidinančiai (pvz., nėra informacijos lietuvių kalba, netiksli sudėtis, nėra galiojimo datos)',
              'Produktas neaiškios kilmės arba galimai nelegaliai įvežtas',
              'Produktas turi neįprastą kvapą, spalvą, konsistenciją arba atrodo sugedęs',
              'Įtariama, kad produkte yra neleistinų ar pavojingų medžiagų',
              'Produktas falsifikuotas arba imituojantis kito gamintojo produktą',
              'Informacija apie produktą klaidinanti ar neišsami',
              'Kiti pažeidimai',
            ]),
            spField: 'paz_tip3',
            dynamicFields: [
              ...dm(4, [1], {
                condition: false,
              }),
            ],
          }),
          q.text(9, 18, 'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes', {
            required: true,
            spField: 'aplink',
          }),
          q.text(
            '9.5',
            10,
            'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes',
            {
              required: true,
              spField: 'aplink',
            },
          ),
        ],
      },
      {
        ...pages.tipas(),
        questions: [
          q.radio(10, undefined, 'Pasirinkite apie ką pranešate', {
            options: [os('Veterinarinius vaistus', 11), os('Pašarus', 11)],
            required: true,
            spField: 'pran_apie',
          }),
          q.input(11, 12, 'Nurodykite tikslų, pilną produkto pavadinimą.', {
            required: true,
            spField: 'produkt_pav',
          }),
          q.number(12, 13, 'Nurodykite apie kokį produkto kiekį pranešate', {
            required: true,
            spField: 'kiekis',
          }),
          q.select(13, 14, 'Pasirinkite nurodyto produkto kiekio matavimo vienetus', {
            options: o(['Vienetai', 'Gramai', 'Kilogramai', 'Mililitrai', 'Litrai']),
            required: true,
            spField: 'matas',
          }),
          q.input(14, 15, 'Jei galite nurodykite produkto gamintoją', {
            required: false,
            spField: 'produkt_gam',
          }),
          q.input(15, 16, 'Jei galite nurodykite produkto platintoją', {
            required: false,
            spField: 'produkt_plat',
          }),
          q.input(16, 17, 'Jei galite nurodykite produkto partijos numerį', {
            required: false,
            spField: 'part_num',
          }),
          q.date(17, 18, 'Jei galite nurodykite produkto tinkamumo vartoti terminą', {
            required: false,
            spField: 'vart_term',
          }),
        ],
        dynamicFields: [
          ...dm(4, [1], {
            condition: false,
          }),
        ],
      },
      {
        ...pages.vieta(),
        questions: [
          q.radio(18, undefined, 'Nurodykite produkto prekybos vietą', {
            options: [
              os('Fizinė parduotuvė', 19),
              os('Internetinė parduotuvė', 20),
              os('Socialiniai tinklai', 21),
            ],
            required: false,
            spField: 'prekyb_vieta',
            dynamicFields: [
              ...dm(4, [1], {
                title: 'Nurodykite apie kokio tipo veiklą pranešate',
              }),
            ],
          }),
          q.address(19, 22, 'Nurodykite prekybos vietos adresą', {
            required: true,
            spField: 'adresas',
            dynamicFields: [
              ...dm(4, [1], {
                title: 'Nurodykite veiklos vietos adresą',
              }),
            ],
            condition: [
              {
                question: 18,
                valueIndex: 0,
              },
            ],
          }),
          q.input(20, 22, 'Nurodykite prekybos puslapio nuorodą', {
            required: true,
            spField: 'psl_adresas',
            dynamicFields: [
              ...dm(4, [1], {
                title: 'Nurodykite veiklos vykdymo puslapio nuorodą',
              }),
            ],
            condition: [
              {
                question: 18,
                valueIndex: 1,
              },
            ],
          }),
          q.input(21, 22, 'Nurodykite nuorodą į socialinius tinklus', {
            required: true,
            spField: 'psl_adresas',
            condition: [
              {
                question: 18,
                valueIndex: 2,
              },
            ],
          }),
          q.input(22, 23, 'Nurodykite produkto prekybos vietos pavadinimą', {
            required: true,
            spField: 'prekyb_pav',
            dynamicFields: [
              ...dm(4, [1], {
                title: 'Nurodykite veiklos vietos pavadinimą',
              }),
            ],
          }),
          q.text(
            23,
            24,
            'Jei galite nurodykyte fizinius ar juridinius asmenis vykdančius prekybos veiklą',
            {
              required: true,
              spField: 'pap_adr_info',
              dynamicFields: [
                ...dm(4, [1], {
                  title: 'Jei galite nurodykyte fizinius ar juridinius asmenis vykdančius veiklą',
                }),
              ],
            },
          ),
          q.text(
            24,
            25,
            'Nurodykite visą žinomą papildomą informaciją apie prekybos vietą, nuo darbo valandų iki patekimo į patalpas informacijos',
            {
              required: true,
              spField: 'patek',
              dynamicFields: [
                ...dm(4, [1], {
                  title:
                    'Nurodykite visą žinomą papildomą informaciją apie veiklos vietą, nuo darbo valandų iki patekimo į patalpas informacijos',
                }),
              ],
            },
          ),
        ],
      },
      // == dokumentai ==
      {
        title: 'Vaizdinė medžiaga ir kiti dokumentai',
        description:
          'Pridėkite vaizdinę medžiagą (nuotraukas, video) arba kitus dokumentus įrodančius pateikiamus pažeidimus',
        questions: [
          q.files(
            25,
            26,
            'Jei galite pridėkite nuotraukas ar kitus dokumentus kuriuose atsispindėtu pranešami pažeidimai',
            {
              required: false,
              spField: 'files',
            },
          ),
          q.files(
            26,
            27,
            'Jei galite pridėkite nuotraukas ar kitus dokumentus kuriuose atsispindėtu pranešami pažeidimai',
            {
              required: false,
              spField: 'files_zenkl',
              dynamicFields: [
                ...dm(4, [1], {
                  condition: false,
                }),
              ],
            },
          ),
          q.files(27, 28, 'Jei galite pridėkite dokumentus įrodančius produkto įsigijimo faktą', {
            required: false,
            spField: 'files_fakt',
            dynamicFields: [
              ...dm(4, [1], {
                condition: false,
              }),
            ],
          }),
          q.files(28, 29, 'Jei galite pridėkite kitus su pranešamu įvykiu susijusius įrodymus', {
            required: false,
            spField: 'files_kiti',
          }),
        ],
      },

      pages.teises(29),

      // =======================================
    ],
  },
  // SURVEY 4
  {
    title: 'Įtarimų dėl plintančių gyvūnų ligų ir gaišenų pranešimų anketa',
    icon: `<svg viewBox="0 0 55 54" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M15.3418 49.5V43.4925C15.3418 40.32 16.6018 37.26 18.8518 35.01C21.1018 32.76 24.1618 31.5 27.3343 31.5C33.9718 31.5 39.3268 36.8775 39.3268 43.4925V49.5H15.3418Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M44.5918 38.9927V34.4927" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M4.83398 49.5001H15.3415V44.2576L4.83398 39.0151V49.5226V49.5001Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M18.8518 35.01L15.3418 31.5L18.3343 28.5075L16.8268 27" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M15.3418 49.4999C15.3418 47.9024 15.9718 46.3724 17.0968 45.2474C18.2218 44.1224 19.7518 43.4924 21.3268 43.4924C21.3268 40.1849 24.0043 37.4849 27.3343 37.4849C33.9493 37.4849 39.3268 42.8624 39.3268 49.4774H15.3193L15.3418 49.4999Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M49.8336 44.2576C49.8336 41.3551 47.4936 39.0151 44.5911 39.0151C41.6886 39.0151 39.3486 41.3551 39.3486 44.2576V49.5001H44.5911C47.4936 49.5001 49.8336 47.1601 49.8336 44.2576Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M30.1243 19.3277L39.7318 23.5352C42.9268 24.9302 46.6393 23.4677 48.0343 20.2952C49.4293 17.1002 47.9668 13.3877 44.7943 11.9927L35.1868 7.78517C31.9918 6.39017 28.2793 7.85267 26.8843 11.0252C25.4893 14.2202 26.9518 17.9327 30.1243 19.3277Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M42.2736 17.7524C41.1261 15.8399 39.2586 15.1874 37.0761 15.6374C35.1411 16.0424 33.5886 15.2099 32.6436 13.5449" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M26.8612 11.025L24.1387 9.85498" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M27.2661 16.8525L24.7461 18.405" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M43.4893 23.9399L44.0743 26.8424" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M48.0342 20.2725L50.7567 21.465" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M47.6289 14.4675L50.1714 12.915" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M31.4063 7.38008L30.8213 4.45508" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M34.9161 21.4873L33.7236 24.2098" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M39.9561 9.78744L41.1486 7.06494" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
    description:
      'Pranešimai apie pastebėtas laukinių gyvūnų gaišenas, galimai susijusias su plintančiomis gyvūnų ligomis, pranešimai apie pastebėtas ūkinių gyvūnų gaišenas.',
    authType: SurveyAuthType.OPTIONAL,
    spList: '',
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
              os('Pranešimai apie šernų gaišenas', 5, 'REIKIA.'), // GGL1
              os('Pranešimai apie kitų gyvūnų ar paukščių gaišenas', 5, 'REIKIA 2.'), // GGL2
              os('Pranešimai apie segančius gyvūnūs ar paukščius', 5, 'REIKIA 3.'), // GGL3
            ],
            spField: 'pran_tema',
          }),
        ],
      },
      // =======================================
      {
        ...pages.tipas(),
        questions: [
          q.date(5, 6, 'Nurodykite pranešamo įvykio datą', {
            spField: 'ivyk_data',
            required: true,
          }),
          q.radio(6, 7, 'Ar pretenduojate gauti išmoką dėl rastos šerno gaišenos?', {
            required: true,
            riskEvaluation: false,
            options: o(['Taip', 'Ne']),
            dynamicFields: [
              ...dm(4, [1, 2], {
                condition: false,
              }),
            ],
          }),
          q.text(
            7,
            8,
            'Nurodykite kokie simptomai pasireiškė gyvūnui kurie sukėlė įtarimų apie gyvūno galimą sergamumą plintančiomis ligomis',
            {
              required: true,
              dynamicFields: [
                ...dm(4, [0, 1], {
                  condition: false,
                }),
              ],
            },
          ),
          q.radio(8, 9, 'Ar dėl įtariamų simptomų kreipėtės į veterinarijos gydytojus?', {
            required: true,
            spField: 'ar_kreiptasi',
            riskEvaluation: false,
            options: o(['Taip', 'Ne']),
            dynamicFields: [
              ...dm(4, [0, 1], {
                condition: false,
              }),
            ],
          }),
          q.text(9, 10, 'Nurodykite visus su pranešamu įvykiu susijusius faktus ir aplinkybes', {
            required: true,
            spField: 'aplink',
          }),
        ],
      },
      {
        ...pages.detales(),
        questions: [
          q.radio(10, 11, 'Nurodykite apie kokio tipo gaišeną pranešate', {
            required: true,
            riskEvaluation: false,
            options: o(['Rasta gaišena', 'Eismo įvykis']),
            dynamicFields: [
              ...dm(4, [2], {
                condition: false,
              }),
            ],
          }),
          q.multiselect(11, 14, 'Nurodykite apie kokio tipo gyvūnus pranešate', {
            required: true,
            spField: 'paz_tip3',
            options: [
              os('Gyvūnas augintinis', '11.1'),
              os('Ūkinis gyvūnas', '11.2'),
              os('Laukinis gyvūnas', '11.3'),
            ],
            dynamicFields: [
              ...dm(4, [0], {
                condition: false,
              }),
            ],
          }),
          q.multiselect(
            '11.1',
            undefined,
            'Pasirinkite apie kokios rūšies gyvūną ar gyvūnus pranešate',
            {
              required: true,
              options: [os('Šuo', 14), os('Katė', 14), os('Šeškas', 14), os('Kita', '11.1.1')],
              condition: c(11),
            },
          ),
          q.input(
            '11.1.1',
            14,
            'Nurodykite gyvūnų apie kuriuos pranešate pavadinimus jei jų pasirenkamame saraše nebuvo',
            {
              required: true,
              spField: 'gyv_pav',
              condition: [
                {
                  question: 11,
                  valueIndex: 0,
                },
                {
                  question: '11.1',
                  valueIndex: 3,
                },
              ],
            },
          ),
          q.multiselect(
            '11.2',
            undefined,
            'Pasirinkite apie kokios rūšies gyvūną ar gyvūnus pranešate',
            {
              required: true,
              options: [
                os('Galvijas', 14),
                os('Ožka', 14),
                os('Kiaulė', 14),
                os('Pauštis', 14),
                os('Arklys', 14),
                os('Kita', '11.2.1'),
              ],
              condition: c(11),
            },
          ),
          q.input(
            '11.2.1',
            14,
            'Nurodykite gyvūnų apie kuriuos pranešate pavadinimus jei jų pasirenkamame saraše nebuvo',
            {
              required: true,
              spField: 'gyv_pav',
              condition: [
                {
                  question: 11,
                  valueIndex: 1,
                },
                {
                  question: '11.2',
                  valueIndex: 5,
                },
              ],
            },
          ),
          q.multiselect(
            '11.3',
            undefined,
            'Pasirinkite apie kokios rūšies gyvūną ar gyvūnus pranešate',
            {
              required: true,
              options: [
                os('Šernas', 14),
                os('Stirna', 14),
                os('Paukštis', 14),
                os('Briedis', 14),
                os('Lapė', 14),
                os('Kita', '11.3.1'),
              ],
              condition: c(11),
            },
          ),
          q.input(
            '11.3.1',
            14,
            'Nurodykite gyvūnų apie kuriuos pranešate pavadinimus jei jų pasirenkamame saraše nebuvo',
            {
              required: true,
              spField: 'gyv_pav',
              condition: [
                {
                  question: 11,
                  valueIndex: 2,
                },
                {
                  question: '11.3',
                  valueIndex: 5,
                },
              ],
            },
          ),
        ],
      },
      {
        ...pages.vieta(),
        questions: [
          q.radio(14, undefined, 'Ar galite nurodyti tikslų gaišenos vietos adresą?', {
            required: true,
            options: [os('Taip', 15), os('Ne', 16)],
          }),
          q.address(15, 16, 'Nurodykite adresą, kuriuo vykdoma veterinarijos praktikos veikla', {
            required: true,
            spField: 'adresas',
            condition: [
              {
                question: 14,
                valueIndex: 0,
              },
            ],
          }),
          q.input(16, 17, 'Nurodykite gyvūnų laikymo vietos koordinates', {
            required: true,
            spField: 'koord',
            condition: [
              {
                question: 14,
                valueIndex: 1,
              },
            ],
          }),
          q.text(17, 18, 'Nurodykite visą papildomą informaciją apie pranešamo įvykio vietą', {
            required: false,
            spField: 'pap_adr_info',
          }),
        ],
      },
      {
        title: 'Vaizdinė medžiaga ir kiti dokumentai',
        description:
          'Pridėkite vaizdinę medžiagą (nuotraukas, video) arba kitus dokumentus įrodančius pateikiamus pažeidimus',
        questions: [
          q.files(18, 19, 'Jei galite pridėkite kitus su pranešamu įvykiu susijusius įrodymus', {
            required: false,
            spField: 'irodym',
          }),
        ],
      },
      pages.teises(19),
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
              requiresAuth: optionData.requiresAuth,
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

'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';

import {
  CommonFields,
  CommonPopulates,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  Table,
  EndpointType,
} from '../types';
import { Page } from './pages.service';
import { Question } from './questions.service';

export enum SurveyAuthType {
  OPTIONAL = 'OPTIONAL',
  REQUIRED = 'REQUIRED',
  NONE = 'NONE',
}

interface Fields extends CommonFields {
  title: string;
  description: string;
  icon: string;
  priority: number;
  firstPage: Page['id'];
  authType: SurveyAuthType;
  spList?: string;
}

interface Populates extends CommonPopulates {
  firstPage: Page<'questions'>;
}

interface MermaidFeatures extends Record<string, boolean> {
  conditions: boolean;
  dynamicFields: boolean;
  spField: boolean;
  type: boolean;
}

export type Survey<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'surveys',

  mixins: [
    DbConnection({
      collection: 'surveys',
      rest: false,
    }),
  ],

  settings: {
    fields: {
      id: {
        type: 'number',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },

      title: 'string',
      description: 'string',
      icon: 'string',

      priority: {
        type: 'number',
        default: 0,
      },

      spList: {
        type: 'string',
      },

      firstPage: {
        type: 'number',
        columnType: 'integer',
        columnName: 'firstPageId',
        required: true,
        populate: {
          action: 'pages.resolve',
          params: {
            populate: 'questions',
          },
        },
      },

      authType: {
        type: 'string',
        required: true,
        enum: Object.values(SurveyAuthType),
        default: SurveyAuthType.NONE,
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class SurveysService extends moleculer.Service {
  @Action({
    rest: 'GET /',
  })
  async getAll(ctx: Context) {
    return this.findEntities(ctx, {
      sort: '-priority',
    });
  }

  @Method
  html(body = '', head = '') {
    return `<html>
<head>
  <meta http-equiv="content-type" content="text/html; charset=utf-8">
  ${head}
</head>
<body>${body}</body>
</html>
`;
  }

  @Method
  mermaidQueryParams(featuresSource: MermaidFeatures, featureToToggle?: string) {
    const features = {
      ...featuresSource,
    };

    if (featureToToggle) {
      features[featureToToggle] = !featuresSource[featureToToggle];
    }

    return Object.keys(features)
      .filter((feature) => features[feature])
      .map((feature) => `${feature}=true`)
      .join('&');
  }

  @Action({
    auth: EndpointType.PUBLIC,
    rest: 'GET /mermaid',
    params: {
      id: 'number|convert|optional',
      ...['conditions', 'dynamicFields', 'spField', 'type'].reduce(
        (acc, curr) => ({
          ...acc,
          [curr]: {
            type: 'boolean',
            default: false,
            convert: true,
          },
        }),
        {},
      ),
    },
  })
  async mermaid(ctx: Context<{ id?: Survey['id'] } & MermaidFeatures, any>) {
    const { id, ...features } = ctx.params;

    if (!id) {
      const surveys: Survey[] = await ctx.call('surveys.find', { limit: 1 });
      ctx.meta.$statusCode = 302;
      ctx.meta.$location = `?id=${surveys[0].id}&dynamicFields=true`;

      return;
    }

    const surveys: Survey[] = await ctx.call('surveys.find');

    const survey: Survey = await ctx.call('surveys.resolve', {
      id: ctx.params.id,
    });

    const questions: Question[] = await ctx.call('questions.find', {
      query: {
        survey: ctx.params.id,
      },
    });

    const uniquePages = questions
      .map((q) => q.page)
      .filter((value, index, array) => array.indexOf(value) === index);

    const pages: Array<Page<'questions'>> = await ctx.call('pages.resolve', {
      id: uniquePages,
      populate: 'questions',
    });

    ctx.meta.$responseType = 'text/html';
    return this.html(
      `<ul>${surveys
        .map(
          (survey) =>
            `<li><a href="?id=${survey.id}&${this.mermaidQueryParams(features)}">${
              survey.title
            }</li>`,
        )
        .join('')}</a></ul>
      <h1>${survey.title}</h1>
      <div><b>Autentifikacija:</b> ${
        survey.authType === SurveyAuthType.NONE
          ? 'nėra'
          : survey.authType === SurveyAuthType.OPTIONAL
          ? 'pasirinktinai'
          : 'privalom'
      }</div>
<div><b>spList:</b> ${survey.spList || '-'}</div>

      <div style="margin-top: 50px">
      <b>Features (kai kurias diagramas labai iškraipo)</b>
      <form method="GET">
        <input type="hidden" name="id" value="${id}" />
        ${Object.keys(features)
          .map(
            (feature) =>
              `<div><label><input type="checkbox" onChange="this.form.submit()" value="true" name="${feature}"${
                features[feature] ? ' checked' : ''
              } /> ${feature}</label></div>`,
          )
          .join('')}

      </form>
      </div>

      <div style="margin-top: 50px">
      <b>Plotis</b>
      <button onclick="document.getElementsByTagName('pre')[0].style.width='10%'">10%</button>
      <button onclick="document.getElementsByTagName('pre')[0].style.width='50%'">50%</button>
      <button onclick="document.getElementsByTagName('pre')[0].style.width='100%'">100%</button>
      <button onclick="document.getElementsByTagName('pre')[0].style.width='150%'">150%</button>
      <button onclick="document.getElementsByTagName('pre')[0].style.width='200%'">200%</button>
      <button onclick="document.getElementsByTagName('pre')[0].style.width='300%'">300%</button>
      <button onclick="document.getElementsByTagName('pre')[0].style.width='400%'">400%</button>
      <button onclick="document.getElementsByTagName('pre')[0].style.width='500%'">500%</button>
      <button onclick="document.getElementsByTagName('pre')[0].style.width='1000%'">1000%</button>
      </div>
<pre class="mermaid">
%%{
  init: {
    "theme": "light",
    "logLevel": "info",
    "flowchart": {
      "htmlLabels": false
    }
  }
}%%
flowchart TB;
  ${pages.map((page) => this.mermaidPage(page, features, id)).join('\n')}
  ${this.mermaidRelations(pages, features)}
  ${this.mermaidStyles(pages)}
  classDef question fill:#e0ebff,stroke:#000,stroke-width:1px,color:#000
  classDef option fill:#f5f5f5,stroke:#000,stroke-width:1px,color:#000
  classDef optional fill:#bfd6c7,stroke:#008f32,stroke-width:2px,color:#000,fill-opacity:100%
  classDef condition fill:#f0e7a1,stroke:#ad9900,stroke-width:2px,color:#000,fill-opacity:100%
</pre>`,
      `<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
  mermaid.initialize({
    startOnLoad: true,
    securityLevel: 'loose'
  });
</script>
`,
    );
  }
  @Method
  mermaidIdWithTitle(id: number, title?: string) {
    return `${id}["\`_${id}._ ${title}\`"]`;
  }

  @Method
  mermaidQuestion(question: Question<'options'>, features: MermaidFeatures, id: number) {
    return `subgraph question-${this.mermaidIdWithTitle(question.id, question.title)}
  ${question.options
    .map((option) => `option-${this.mermaidIdWithTitle(option.id, option.title)}`)
    .join('\n  ')}
 ${!question.required ? `optional-${question.id}>Neprivalomas];` : ''}
 ${features.spField && question.spField ? `spField-${question.id}[/${question.spField}\\];` : ''}
 ${
   features.conditions && question.condition.length > 0
     ? `condition-${question.id}{{Rodomas jei}};`
     : ''
 }
${features.type ? `type-${question.id}{{${question.type}}};` : ''}
 ${
   features.dynamicFields && question.dynamicFields?.length
     ? `dynamic-${question.id}[/"${question.dynamicFields
         .map((df) =>
           Object.keys(df.values)
             .map(
               (field) =>
                 `${field}:${(df.values as any)[field]} (${df.condition.question} = ${
                   df.condition.value
                 })`,
             )
             .join('\n'),
         )
         .join('\n')}"/];
        click dynamic-${question.id} href "?id=${id}&${this.mermaidQueryParams(
         features,
         `dynamicFieldsPointers${question.id}`,
       )}"
         `
     : ''
 }
end`;
  }

  @Method
  mermaidRelations(pages: Array<Page<'questions'>>, features: MermaidFeatures) {
    return pages
      .map((page) =>
        page.questions
          .map(
            (question) =>
              `${
                features.conditions && question.condition.length > 0
                  ? `condition-${question.id} -.-> option-${question.condition.map(
                      (condition) => ` ${condition.value}`,
                    )}`
                  : ''
              }
              ${
                question.nextQuestion
                  ? `question-${question.id} --> question-${question.nextQuestion}`
                  : ''
              }
              ${question.options
                .map((option) =>
                  option.nextQuestion
                    ? `option-${option.id} --> question-${option.nextQuestion}`
                    : '',
                )
                .join('\n')}
              ${
                !!features[`dynamicFieldsPointers${question.id}`] && question.dynamicFields?.length
                  ? question.dynamicFields
                      .map((df) =>
                        Object.keys(df.values)
                          .map(() => `dynamic-${question.id} -.-> option-${df.condition.value}`)
                          .join('\n'),
                      )
                      .join('\n')
                  : ''
              }
                `,
          )
          .join('\n'),
      )
      .join('\n');
  }

  @Method
  mermaidStyles(pages: Array<Page<'questions'>>) {
    return pages
      .map(
        (page) =>
          `class page-${page.id} page
           ${page.questions
             .map(
               (question) =>
                 `class question-${question.id} question
                 class optional-${question.id} optional
                 class condition-${question.id} condition
              ${question.options.map((option) => `class option-${option.id} option`).join('\n')}`,
             )
             .join('\n')}`,
      )
      .join('\n');
  }

  @Method
  mermaidPage(page: Page<'questions'>, features: MermaidFeatures, id: number) {
    return `subgraph page-${this.mermaidIdWithTitle(page.id, page.title)}
    direction LR
${
  features.dynamicFields && page.dynamicFields?.length
    ? `dynamic-page-${page.id}[/"${page.dynamicFields
        .map((df) =>
          Object.keys(df.values)
            .map(
              (field) =>
                `${field}:${(df.values as any)[field]} (${df.condition.question} = ${
                  df.condition.value
                })`,
            )
            .join('\n'),
        )
        .join('\n')}"/];
         `
    : ''
}
  ${page.questions.map((question) => this.mermaidQuestion(question, features, id)).join('\n  ')}
end`;
  }
}

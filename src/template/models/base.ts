import type {
  TemplateCategory,
  TemplateHeading,
  TemplateSchema,
  TemplateSection,
} from "../types";

export abstract class TemplateBase<
  TTemplateType extends string,
  TSectionKey extends string,
> {
  abstract readonly category: TemplateCategory;

  constructor(
    public readonly heading: TemplateHeading<TTemplateType>,
    public readonly sourcePath: string,
    public readonly sections: Array<TemplateSection<TSectionKey>>,
  ) {}

  toJSON(): TemplateSchema<TTemplateType, TSectionKey> {
    return {
      category: this.category,
      heading: this.heading,
      sourcePath: this.sourcePath,
      sections: this.sections,
    };
  }
}

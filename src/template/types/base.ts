export type TemplateCategory = "exploration" | "plan";

export type SectionFormat =
  | "markdown"
  | "bulletList"
  | "numberedList"
  | "mermaid"
  | "checklist"
  | "mixed";

export interface TemplateHeading<TKey extends string = string> {
  text: string;
  key: TKey;
}

export interface TemplateSection<TSectionKey extends string = string> {
  heading: TemplateHeading<TSectionKey>;
  format: SectionFormat;
  body: string;
}

export interface TemplateSchema<
  TTemplateType extends string = string,
  TSectionKey extends string = string,
> {
  category: TemplateCategory;
  heading: TemplateHeading<TTemplateType>;
  sourcePath: string;
  sections: Array<TemplateSection<TSectionKey>>;
}

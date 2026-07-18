declare module "mjml" {
  export type MjmlError = {
    line?: number;
    message: string;
    tagName?: string;
    formattedMessage?: string;
  };

  export type MjmlOptions = {
    validationLevel?: "strict" | "soft" | "skip";
    filePath?: string;
    minify?: boolean;
    keepComments?: boolean;
    beautify?: boolean;
  };

  export type MjmlCompileResult = {
    html: string;
    errors: MjmlError[];
  };

  export default function mjml2html(
    mjml: string,
    options?: MjmlOptions,
  ): MjmlCompileResult;
}

import { defineCollection, z } from "astro:content";

const pages = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    tagline: z.string().optional(),
    intro: z.string().optional(),
    cta: z
      .object({
        label: z.string(),
        link: z.string().url()
      })
      .optional(),
    highlights: z
      .array(
        z.object({
          title: z.string(),
          description: z.string()
        })
      )
      .optional()
  })
});

const events = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.string(),
    time: z.string().optional(),
    location: z.string().optional(),
    price: z.string().optional(),
    description: z.string().optional(),
    program: z
      .array(
        z.object({
          work: z.string(),
          composer: z.string().optional(),
          performers: z.string().optional()
        })
      )
      .optional(),
    body: z.string().optional()
  })
});

export const collections = {
  pages,
  events
};

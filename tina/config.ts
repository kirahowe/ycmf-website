import { defineConfig } from "tinacms";

const branch =
  process.env.TINA_BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  process.env.HEAD ||
  "main";

export default defineConfig({
  branch,
  clientId: process.env.TINA_CLIENT_ID,
  token: process.env.TINA_TOKEN,
  build: {
    outputFolder: "admin",
    publicFolder: "public"
  },
  media: {
    tina: {
      mediaRoot: "",
      publicFolder: "public"
    }
  },
  schema: {
    collections: [
      {
        label: "Pages",
        name: "pages",
        path: "src/content/pages",
        format: "md",
        ui: {
          router: ({ document }) => {
            if (document._sys.filename === "home") {
              return "/";
            }
            return undefined;
          }
        },
        fields: [
          {
            type: "string",
            name: "title",
            label: "Title",
            isTitle: true,
            required: true
          },
          {
            type: "string",
            name: "tagline",
            label: "Tagline"
          },
          {
            type: "string",
            name: "intro",
            label: "Intro",
            ui: {
              component: "textarea"
            }
          },
          {
            type: "object",
            name: "cta",
            label: "Call to Action",
            fields: [
              {
                type: "string",
                name: "label",
                label: "Label"
              },
              {
                type: "string",
                name: "link",
                label: "Link"
              }
            ]
          },
          {
            type: "object",
            name: "highlights",
            label: "Highlights",
            list: true,
            fields: [
              {
                type: "string",
                name: "title",
                label: "Title"
              },
              {
                type: "string",
                name: "description",
                label: "Description",
                ui: {
                  component: "textarea"
                }
              }
            ]
          }
        ]
      },
      {
        label: "Events",
        name: "events",
        path: "src/content/events",
        format: "md",
        fields: [
          {
            type: "string",
            name: "title",
            label: "Title",
            isTitle: true,
            required: true
          },
          {
            type: "datetime",
            name: "date",
            label: "Date",
            required: true,
            ui: {
              dateFormat: "MMM dd, yyyy"
            }
          },
          {
            type: "string",
            name: "time",
            label: "Time"
          },
          {
            type: "string",
            name: "location",
            label: "Location"
          },
          {
            type: "string",
            name: "price",
            label: "Price"
          },
          {
            type: "string",
            name: "description",
            label: "Short Description",
            ui: {
              component: "textarea"
            }
          },
          {
            type: "string",
            name: "body",
            label: "Details",
            ui: {
              component: "textarea"
            }
          },
          {
            type: "object",
            name: "program",
            label: "Program",
            list: true,
            fields: [
              {
                type: "string",
                name: "work",
                label: "Work",
                required: true
              },
              {
                type: "string",
                name: "composer",
                label: "Composer"
              },
              {
                type: "string",
                name: "performers",
                label: "Performers"
              }
            ]
          }
        ]
      }
    ]
  }
});

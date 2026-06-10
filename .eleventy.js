const fs   = require('fs');
const path = require('path');

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy({ admin: "admin" });
  eleventyConfig.addPassthroughCopy({ "src/_data/schema.json": "admin/schema.json" });

  eleventyConfig.addFilter("youtubeEmbedUrl", function(url) {
    if (!url) return "";
    let videoId = "";
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "youtu.be") {
        videoId = parsed.pathname.slice(1);
      } else if (parsed.hostname.includes("youtube.com")) {
        videoId = parsed.searchParams.get("v");
        if (!videoId && parsed.pathname.startsWith("/embed/")) {
          videoId = parsed.pathname.split("/")[2];
        }
      }
    } catch (e) {
      const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
      if (match) videoId = match[1];
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
  });

  // Auto-register a collection for every folder collection defined in schema.json
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/_data/schema.json'), 'utf8'));
  for (const coll of schema._collections || []) {
    if (!coll.folder) continue;
    const ext = coll.extension || 'json';
    eleventyConfig.addCollection(coll.name, function () {
      const dir = path.join(__dirname, coll.folder);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter(f => f.endsWith(`.${ext}`))
        .map(f => {
          const slug = f.replace(new RegExp(`\\.${ext}$`), '');
          const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return { slug, ...data };
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    });
  }

  return {
    templateFormats: ["njk", "md", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
};

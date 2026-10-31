document.querySelectorAll("form").forEach((form) => {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const banner = document.getElementById("submit-banner") || document.getElementById("wd-done") || document.getElementById("lv-done");
    if (banner) banner.style.display = "block";
  });
});

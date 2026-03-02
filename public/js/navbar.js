document.addEventListener('DOMContentLoaded', function () {
  const navbar = document.getElementById('mainNavbar');
  let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollDelta = 5;

  function isMobile() {
    return window.innerWidth <= 1024; // Tailwind lg breakpoint (<= 1024px)
  }

  // Set body padding equal to navbar height (prevents overlap with content)
  function setBodyPadding() {
    if (navbar) {
      const navbarHeight = navbar.offsetHeight;
      document.body.style.paddingTop = navbarHeight + 'px';
    }
  }

  window.addEventListener('scroll', function () {
    if (!isMobile()) {
      // Always show navbar on desktop
      navbar.classList.remove('nav-up');
      return;
    }

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    if (Math.abs(scrollTop - lastScrollTop) > scrollDelta) {
      if (scrollTop > lastScrollTop && scrollTop > 100) {
        navbar.classList.add('nav-up'); // hide
      } else {
        navbar.classList.remove('nav-up'); // show
      }
      lastScrollTop = scrollTop;
    }
  });

  window.addEventListener('resize', function () {
    setBodyPadding();
    if (!isMobile()) {
      navbar.classList.remove('nav-up');
    }
  });

  // Initialize on load
  setBodyPadding();
});

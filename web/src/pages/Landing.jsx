import "../landing.css";
import Nav from "../components/landing/Nav.jsx";
import Hero from "../components/landing/Hero.jsx";
import Asks from "../components/landing/Asks.jsx";
import Story from "../components/landing/Story.jsx";
import Proof from "../components/landing/Proof.jsx";
import SmallPrint from "../components/landing/SmallPrint.jsx";
import Faq from "../components/landing/Faq.jsx";
import Closing from "../components/landing/Closing.jsx";
import Footer from "../components/landing/Footer.jsx";

export default function Landing() {
  return (
    <div className="lp">
      <Nav />
      <main>
        <Hero />
        <Asks />
        <Story />
        <Proof />
        <SmallPrint />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
